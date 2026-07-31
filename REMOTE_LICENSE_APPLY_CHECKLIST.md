# GAS / 구글 시트 적용 안내 (테스트 후 배포)

이 파일은 코드 변경에 맞춘 **운영자 체크리스트**입니다. 실제 시트·Apps Script 반영은 테스트 후 직접 진행하세요.

## 1. Google Apps Script
1. EzImpo 전용 스프레드시트 → 확장 프로그램 → Apps Script
2. `GAS_Migration_Script_Updated.txt` 내용을 **배포(웹 앱)** 에 반영
3. 새 버전으로 웹 앱 배포 (기존 URL 유지 권장)

추가된 action:
- `claim_pending_license` — PushStatus=READY + MachineID 일치 시 키/PIN 지급 후 CLAIMED
- `check_company` — 회사명으로 기존 Licenses 건수 조회 (중복 안내, 차단 아님)

## 2. Order 시트 (열 추가만, 기존 행 유지)
기존 9열 유지 + **뒤에만** 추가:
- J열: `사용자명`
- K열: `PIN`

헤더가 없으면 GAS가 첫 요청 시 자동으로 붙이도록 작성되어 있습니다.

## 3. Licenses 시트 (열 추가만)
- 맨 뒤(또는 헤더 기준): `PushStatus`
  - (비움) = 기존 방식(문자/수동) — **기존 정품 사용자 영향 없음**
  - `READY` = 원격 적용 대기
  - `CLAIMED` = 고객 앱이 수령 완료

## 4. 라이선스플로우 매니저
- 요청 목록에 **원격적용** 버튼 (EzImpo)
- **승인(문자)** = 기존 문자 발송 흐름 유지

## 5. 기존 사용자
- 이미 ACTIVE이고 PushStatus 비어 있으면 claim 대상이 아님
- 로컬 `ez_license_v1.json` 보유 PC는 기존처럼 동작
