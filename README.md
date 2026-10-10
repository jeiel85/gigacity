# Gigacity

시드 하나로 타워·비행차·불빛을 모두 생성하는 절차적 사이버펑크 도시. three.js(WebGL2) 기반 정적 웹 페이지이며 빌드 과정이 없습니다.

## 실행

ES 모듈을 쓰므로 `file://`로는 열리지 않습니다. 아무 정적 서버로 이 폴더를 띄우면 됩니다.

```bash
python -m http.server 5180 --bind 127.0.0.1
```

브라우저에서 `http://127.0.0.1:5180/` 접속. three.js와 폰트는 CDN(jsdelivr, Google Fonts)에서 받으므로 인터넷 연결이 필요합니다.

## 조작

| 입력 | 동작 |
| --- | --- |
| A / D | 좌우로 기울여 도로 폭 안에서 이동 |
| W / S | 상승 / 하강 |
| ⇧T | 터보 토글 |
| ⇧H | 호버(정지) 토글 |
| ⇧V | 운전석 시점 토글 |
| 차 클릭 | 그 차로 갈아타 추적 |

카메라: Chase(추적) · Seat(운전석) · Drone(자유 궤도, 드래그) · Director(자동 컷 전환).

## URL 상태

현재 상태가 해시에 계속 기록되어 그대로 공유할 수 있습니다.

```
#seed=4417&sky=night&view=chase&at=825.3,145.3,849.0&look=119,-5&traffic=70
```

- `seed` 0–99999, `sky` day|dusk|night, `view` chase|seat|drone|director
- `at` 위치(drone은 카메라, 그 외는 주인공 차), `look` 요·피치(도)
- `traffic` 0–100, 기본값 70이면 생략

## 구조

| 파일 | 역할 |
| --- | --- |
| `src/rng.js` | 시드 RNG(mulberry32)와 value noise |
| `src/city.js` | 격자·블록·타워/네온/경고등/지면 생성 |
| `src/traffic.js` | 차선·차량 생성, GPU 인스턴싱, CPU 위치 계산 |
| `src/shaders.js` | 모든 GLSL(창문 패턴, 안개, 차량 배치) |
| `src/sky.js` | Day/Dusk/Night 프리셋, 하늘·별·구름, 전환 보간 |
| `src/hero.js` | 주인공 차 자동 비행과 키 조작 |
| `src/cameras.js` | 네 가지 카메라 모드 |
| `src/main.js` | 렌더러·포스트(블룸)·UI·입력·URL 해시 |

차량 위치는 셰이더가 차선 파라미터와 시간으로 직접 계산합니다(`CAR_PLACE`). 클릭 선택과 Director 카메라는 `traffic.carPos()`가 같은 식을 CPU에서 재현해 씁니다. 두 식은 항상 같이 고쳐야 합니다.

창문 셀 크기는 `city.js`의 `CELLS`(조명 창 개수 통계)와 `shaders.js`의 `cellFor()`(렌더링)에 중복되어 있어 함께 맞춰야 합니다.
