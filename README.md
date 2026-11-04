# 우정 인증봇 (Discord Recovery Bot)

Discord OAuth2 기반 멤버 인증 및 서버 복구 봇.

## 기능

| 기능 | 설명 |
|------|------|
| 멤버 인증 | OAuth2 (`identify email guilds.join`) 로 이메일 + IP 수집 |
| 웹훅 알림 | 인증 완료 시 이메일/IP 를 지정 웹훅으로 전송 |
| 서버 복구 | DB에 저장된 멤버를 서버로 일괄 초대 |
| 토큰 갱신 | 만료 임박 토큰 자동 refresh |

## 슬래시 커맨드

| 커맨드 | 설명 |
|--------|------|
| `/설정 webhook_url:...` | 이 서버의 웹훅 URL 등록 |
| `/인증링크` | 멤버 공유용 OAuth2 링크 생성 (유효 15분) |
| `/인원수` | DB 저장 인원 수 확인 |
| `/불러오기` | 저장된 멤버 전체 초대 (확인 버튼 포함) |

## 셋업

### 1. Discord 애플리케이션 설정

1. [Discord Developer Portal](https://discord.com/developers/applications) 에서 앱 생성
2. **OAuth2 → Redirects** 에 콜백 URL 추가  
   예: `http://localhost:3000/callback`  
   배포 시: `https://yourdomain.com/callback`
3. `Bot` 탭에서 봇 생성 → 토큰 복사

### 2. 환경변수 설정

```bash
cp .env.example .env
```

`.env` 파일 편집:

```env
BOT_TOKEN=your_bot_token
CLIENT_ID=your_application_client_id
CLIENT_SECRET=your_client_secret
REDIRECT_URI=http://localhost:3000/callback
PORT=3000
```

### 3. 봇 초대 URL

다음 URL 로 봇을 서버에 초대 (`bot` + `applications.commands` 스코프):

```
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=8&scope=bot%20applications.commands
```

> `CLIENT_ID` 를 실제 값으로 교체하세요.

### 4. 실행

```bash
# Node.js 18+ 필요
npm install
npm run build
npm start

# 개발 모드 (ts-node)
npm run dev
```

## 사용 흐름

```
관리자                           멤버
  │                               │
  ├─ /설정 webhook_url:...        │
  │   └─ 웹훅 등록됨              │
  │                               │
  ├─ /인증링크                    │
  │   └─ OAuth2 URL 생성         │
  │       └─ URL 공유 ──────────►│
  │                               ├─ 링크 클릭
  │                               ├─ Discord 로그인/승인
  │                               └─ /callback 처리
  │◄─────────────────────────────── 웹훅: 이메일 + IP 도착
  │                               DB에 토큰 저장
  │
  ├─ /인원수
  │   └─ "저장된 인원: N명"
  │
  ├─ /불러오기
  │   └─ 확인 버튼 ─► 실행
  │       └─ 초당 1명씩 서버 초대
  │           └─ 완료 리포트
```

## 주의사항

- **Refresh 토큰 만료**: Discord refresh 토큰은 **30일** 후 만료됨.  
  30일 이상 지난 토큰은 복구 불가 → 해당 멤버는 재인증 필요.
- **레이트 리밋**: Discord `PUT /guilds/{id}/members/{id}` 는 초당 1명 제한.  
  1000명 복구 = 약 17분 소요.
- **콜백 URL**: 외부 접근 가능한 도메인에 배포 시 REDIRECT_URI 도 맞게 수정.

## 파일 구조

```
discord-recovery-bot/
├── src/
│   ├── index.ts        # 진입점
│   ├── config.ts       # 환경변수
│   ├── db.ts           # SQLite (better-sqlite3)
│   ├── discord-api.ts  # Discord REST API 헬퍼
│   ├── server.ts       # Express OAuth2 콜백 서버
│   └── bot.ts          # Discord 봇 + 커맨드
├── .env.example
├── package.json
└── tsconfig.json
```
