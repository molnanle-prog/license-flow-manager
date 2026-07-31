# EzImpo / LicenseFlow — 구글 시트·GAS 전체 적용 안내

이 문서는 **부분 수정이 아니라 탭별 최종 헤더/동작을 한눈에** 보기 위한 운영 가이드입니다.  
테스트 후 직접 시트·Apps Script에 반영하세요. (배포는 사용자께서 진행)

소스 기준:
- 클라이언트: `ezimpo-II`
- GAS: `라이선스-플로우-매니저(...)/GAS_Migration_Script_Updated.txt`
- 매니저: 동일 폴더

---

## 1. 기존 사용자 영향

| 항목 | 영향 |
|------|------|
| 이미 ACTIVE인 Licenses 행 | **유지**. PushStatus 비어 있으면 원격 클레임 대상 아님 |
| 기존 문자 승인 흐름 | **유지** (매니저 「승인(문자)」) |
| 로컬 `ez_license_v1.json` | **유지** |
| InstallLogs 과거 Unknown 행 | 과거 기록은 그대로. **새 설치·신원 저장 후**부터 회사/이름/연락처 기록 |

**규칙:** 기존 열 이름·순서를 바꾸거나 중간 열을 끼워 넣지 말고, **맨 뒤에만 열 추가**.

---

## 2. 탭별 최종 헤더 (복사용)

### 2-1. Licenses (정품 라이선스)

표시(매니저 「사용자」열)는 예전처럼 **한 칸** `Name / Position` = `은희철/대표` 형태.  
이름·직책용 **새 열을 Licenses에 만들 필요 없음**.

권장 헤더 (1행, A열부터 순서대로):

```
License Key
PIN
Company Name
Name / Position
Machine ID
Expiry Date
Status
Payment
Last Check-in
Last Reset
Product Name
Version
Product ID
Created At
Request ID
Contact Info
ID
Last SMS Sent
Payment Date
PushStatus
```

| 열 | 이름 | 설명 |
|----|------|------|
| A | License Key | 키 |
| B | PIN | 재설치 PIN |
| C | Company Name | 상호 |
| D | Name / Position | `이름` 또는 `이름/직책` (한 칸) |
| E | Machine ID | HWID |
| F | Expiry Date | 만료 (비우면 무제한) |
| G | Status | ACTIVE / PENDING / … |
| H | Payment | 입금완료 / 미입금 / … |
| I | Last Check-in | 최근 접속 |
| J | Last Reset | 기기 이전 |
| K | Product Name | EzImpo |
| L | Version | 앱 버전 |
| M | Product ID | 제품 ID |
| N | Created At | 생성일 |
| O | Request ID | 구매요청 ID |
| P | Contact Info | 연락처 |
| Q | ID | 내부 ID |
| R | Last SMS Sent | 마지막 문자 |
| S | Payment Date | 입금일 (기존에 있으면 유지) |
| T | **PushStatus** | **신규.** 비움=기존 / `READY`=원격대기 / `CLAIMED`=앱수령 |

`Payment Date`가 원래 없으면 PushStatus만 맨 뒤에 추가해도 됩니다.  
매니저 스키마는 PushStatus를 마지막 키로 읽습니다.

---

### 2-2. Order (구매 요청)

```
날짜
업체명
입금자
연락처
기기ID
버전
상태
ID
제품명
사용자명
PIN
```

| 열 | 이름 | 설명 |
|----|------|------|
| A~I | (기존 9열) | 날짜~제품명 — **그대로** |
| J | **사용자명** | **신규.** 실제 사용자(이름 또는 이름/직책). 입금자와 분리 |
| K | **PIN** | **신규.** 설치 시 등록 PIN (원격 적용용) |

상태 값은 보통 `PENDING` / `PROCESSED`.

---

### 2-3. InstallLogs (설치/실행 — 체험판 누구인지 보는 곳)

**열 추가 없음.** 기존 10열 유지.  
클라이언트가 신원 저장 후 `company` / `userName` / `contact`를 보내면 매니저에 상호·사용자·연락처가 채워집니다.

```
Timestamp
CompanyName
UserName
Contact
MachineID
ActionType
Result
IP
Version
ProductName
```

| ActionType 예 | 의미 |
|---------------|------|
| Fresh Install | (구버전) 신원 전 실행 — Unknown 가능 |
| Trial Startup | 신원 등록된 체험판 실행 |
| App Startup | 정품 실행 |

한국어 헤더를 쓰는 시트가 있다면 열 **순서만** 위와 같으면 됩니다.

---

### 2-4. 기타 탭 (변경 없음)

- Products, Customers, Settings, DebugLogs, SmsLogs, PurchaseRequests(구형) — **기존 유지**

---

## 3. Google Apps Script (전체 교체 권장)

1. EzImpo 전용 스프레드시트 → 확장 프로그램 → Apps Script  
2. `GAS_Migration_Script_Updated.txt` **전체**를 스크립트 에디터에 붙여넣기  
3. 웹 앱으로 **새 버전 배포** (기존 실행 URL 유지 권장)

주요 action:

| action | 용도 |
|--------|------|
| `verify` | 키 인증 |
| `request_purchase` | 구매 요청 → Order |
| `checkStatusAndVersion` | 상태/버전 |
| `log_startup` | InstallLogs + Licenses 접속 갱신 |
| `claim_pending_license` | PushStatus=READY + HWID 일치 시 키 지급 |
| `check_company` | 회사명 기존 팩 건수 조회 (안내용) |
| `sms_inbound` | 문자 수신 로그 |

---

## 4. 라이선스플로우 매니저 사용

| 버튼 | 동작 |
|------|------|
| **원격적용** | 키 발행 + MachineID·PIN 넣고 PushStatus=`READY` → 고객 앱이 자동 정품 |
| **승인(문자)** | 기존처럼 키 생성 후 문자 발송 화면 |

설치/실행 로그: 신원 입력 후 실행하면 **상호·사용자·연락처**가 보여 체험판 사용자를 식별할 수 있습니다.

---

## 5. 적용 체크리스트

1. [ ] Licenses 1행에 `PushStatus` 열 추가 (맨 뒤)  
2. [ ] Order 1행에 `사용자명`, `PIN` 열 추가 (맨 뒤)  
3. [ ] InstallLogs 헤더 10열 순서 확인 (추가 열 불필요)  
4. [ ] GAS 스크립트 전체 교체 후 웹 앱 재배포  
5. [ ] EzImpo 새 설치본으로 신원 입력 → InstallLogs에 회사/이름 찍히는지 확인  
6. [ ] 구매 원버튼 → Order에 행 + PIN/사용자명 확인  
7. [ ] 매니저 원격적용 → 고객 앱 정품 전환 확인  
8. [ ] 기존 ACTIVE 사용자 로그인·인증 이상 없는지 확인  

---

## 6. 빌드 산출물 위치 (참고)

- EzImpo: `ezimpo-II\dist_installer\EzImpo_Setup_v3.7.3.exe`  
- LicenseFlow: `라이선스-플로우-매니저(...)\LicenseFlow_Release_v1.3.1\` (빌드 후)
