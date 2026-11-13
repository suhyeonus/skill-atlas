# Skill Atlas

이 컴퓨터에 설치된 스킬과 플러그인을 찾아서, 각각 무슨 일을 하는지 목록으로 보여 주는 도구입니다. 터미널과 브라우저 두 가지로 쓸 수 있습니다.

[English](README.en.md)

- 설치할 것이 없습니다. Node.js 18 이상만 있으면 됩니다 (의존성 0개, 빌드 없음).
- 별도 서버나 DB가 없습니다. 실행한 컴퓨터의 폴더를 읽기만 합니다.
- macOS, Windows, Linux에서 동작합니다.

## 실행

```bash
npx github:<계정>/skill-atlas
```

```bash
npx github:<계정>/skill-atlas serve
```

저장소를 받아서 쓸 수도 있습니다.

```bash
git clone https://github.com/<계정>/skill-atlas.git
cd skill-atlas
node bin/cli.js serve
```

## 명령

| 명령 | 하는 일 |
|---|---|
| `skill-atlas` 또는 `skill-atlas list` | 전체 목록을 터미널에 출력 |
| `skill-atlas show <이름>` | 항목 하나의 자세한 정보 (원래 설명, 위치, 버전, 포함 항목) |
| `skill-atlas serve` | 브라우저에서 목록 열기 (`http://127.0.0.1:4317`) |
| `skill-atlas summarize` | Claude로 짧고 쉬운 설명 만들기 (선택 사항) |
| `skill-atlas where` | 어느 폴더를 확인했는지 보기 |

자주 쓰는 옵션:

```bash
skill-atlas list --kind plugin            # 플러그인만
skill-atlas list --source user            # 내가 만든 스킬만
skill-atlas list --search figma           # 이름·설명 검색
skill-atlas list --json                   # JSON으로 출력
skill-atlas list --project ~/work/my-app  # 해당 프로젝트의 .claude 폴더도 함께 확인
skill-atlas serve --port 5000 --no-open
skill-atlas --lang en                     # 언어 지정 (ko 또는 en)
```

전체 옵션은 `skill-atlas --help`로 볼 수 있습니다.

## 화면에서 할 수 있는 것

- 이름이나 설명으로 검색 (`/` 키를 누르면 검색창으로 이동)
- 종류(스킬·플러그인·에이전트·명령)와 찾은 곳으로 걸러 보기
- 항목을 눌러 원래 설명, 버전, 위치 펼쳐 보기
- 한국어/English 전환, 시스템/라이트/다크 테마 전환 (선택은 브라우저에 저장됩니다)

## 어디를 확인하나요

| 표시 | 위치 |
|---|---|
| 내 스킬 폴더 | `~/.claude/skills`, `~/.claude/agents`, `~/.claude/commands` |
| Claude Code 플러그인 | `~/.claude/plugins/installed_plugins.json`에 등록된 플러그인 |
| Claude 앱 | `~/.claude/skills/synced`, `~/.claude/plugins/synced`, 데스크톱 앱 데이터 폴더 |
| 프로젝트 | 현재 폴더와 `--project`로 지정한 폴더의 `.claude` |
| 공용 폴더 | `~/.agents/skills`, `~/.codex/skills`, `~/.cursor/skills`, `~/.gemini/skills` |

같은 항목이 여러 곳에 있으면 하나로 합치고 찾은 곳을 모두 표시합니다. `CLAUDE_CONFIG_DIR` 환경변수를 쓰고 있다면 그 폴더를 `~/.claude` 대신 확인합니다.

## 쉬운 설명 (선택)

기본으로는 각 스킬·플러그인이 원래 가지고 있는 설명을 그대로 보여 줍니다. 이 설명이 길거나 영어라서 읽기 어렵다면 Claude에게 한 줄 요약을 맡길 수 있습니다.

```bash
skill-atlas summarize
```

- 각 항목의 **이름과 설명만** Claude로 전송되고, 한국어와 영어 요약이 만들어집니다.
- Claude Code CLI(`claude`)가 설치·로그인돼 있으면 그 로그인을 그대로 씁니다. **API 키가 필요 없습니다.**
- CLI가 없으면 `ANTHROPIC_API_KEY` 환경변수를 사용합니다. 키는 파일에 적지 말고 셸에서 설정하세요.
- 결과는 저장소 밖(`~/.cache/skill-atlas/summaries.json`, Windows는 `%LOCALAPPDATA%\skill-atlas`)에 저장되고, 설명이 바뀐 항목만 다시 만듭니다.
- 둘 다 없어도 `list`, `show`, `serve`는 원래 설명으로 그대로 동작합니다.

## 개인정보와 보안

- 읽기 전용입니다. 스킬이나 설정을 바꾸지 않습니다.
- `settings.json`에서는 어떤 플러그인이 켜져 있는지(`enabledPlugins`)만 읽습니다. MCP 설정에서는 서버 이름만 가져오고 환경변수·토큰 값은 버립니다. `.env` 파일은 열지 않습니다.
- 출력에 나오는 경로는 홈 폴더를 `~`로 바꿔 표시합니다.
- 웹 화면은 `127.0.0.1`에서만 열리며, 다른 사이트에서 보낸 요청은 거부합니다.
- `summarize`를 실행하기 전에는 어떤 내용도 외부로 나가지 않습니다.

## 개발

```bash
npm test
```

테스트는 임시 폴더에 가짜 홈 디렉터리를 만들어 실행하므로 실제 설정을 건드리지 않습니다.
