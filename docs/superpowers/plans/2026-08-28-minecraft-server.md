# Minecraft Modded Server + Nightwatch Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a modded Minecraft server as a Docker stack on the home server with a modpack picker, lifecycle/console/backup controls integrated into the nightwatch dashboard.

**Architecture:** Two deliverables. (A) A new stack at `/mnt/docker/stacks/minecraft/` — `itzg/minecraft-server` + `itzg/mc-backup` + playit.gg tunnel + a small FastAPI `mc-manager` that owns what nightwatch's locked-down socket-proxy cannot do: recreating the mc container to switch packs, and backup/restore. (B) A `/minecraft` page in nightwatch: pack search (CurseForge + Modrinth), install & switch via the manager, start/stop/logs via the existing docker plumbing, console via a hand-rolled RCON client.

**Tech Stack:** Docker Compose, FastAPI (Python 3.12) + pytest, Next.js 15 App Router, SWR, `node --test`, no new npm runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-28-minecraft-server-design.md`

## Global Constraints

- Nightwatch: **no new npm runtime dependencies** (repo rule). RCON is hand-rolled over `node:net`; pack search uses plain `fetch`.
- Nightwatch tests: Node built-in runner — `npm test` runs `node --test --experimental-strip-types "src/**/*.test.ts"`. Tests colocate next to source as `*.test.ts`, use `node:test` + `node:assert/strict`, and relative imports MUST include the `.ts` extension (e.g. `from "./rcon.ts"`).
- Next 15 route handlers: `export const dynamic = "force-dynamic"`; dynamic params are `ctx: { params: Promise<{...}> }` and must be awaited. No per-route auth code — `src/middleware.ts` gates everything not in `PUBLIC_PATHS`; do NOT add minecraft routes to `PUBLIC_PATHS`.
- UI: no toasts, no `window.confirm()` — inline errors and inline two-step confirms only. Custom UI kit at `src/components/ui/` (`Button`, `Card`, `CardHeader`, `CardTitle`, `CardContent`, `Badge`, `Input`, `Field`, `Select`), icons from `lucide-react`.
- Checked-in docs/defaults use the placeholder host `192.168.1.70`; real values live in `.claude/local-env.md` (gitignored) and the actual server is reached with the SSH alias `ssh server` (bare `ssh connah@<ip>` fails — key is bound to the alias).
- Nightwatch verification: `npx tsc --noEmit && npm run build` is the automated gate; browser-verify on the port-3006 test stack (`docker-compose.test.yml`) before production (3005). Never test against 3005.
- Nightwatch git: every git command needs `-c safe.directory=*`.
- Manager (Python): FastAPI + pytest; all `docker compose` calls go through one injectable wrapper so tests never touch Docker.
- JVM heap default 6G (host has 16GB total); per-instance override.
- itzg env contract (verified 2026-08-28): CurseForge → `TYPE=AUTO_CURSEFORGE`, `CF_PAGE_URL`, `CF_API_KEY`; Modrinth → `TYPE=MODRINTH`, `MODRINTH_MODPACK` (accepts project page URL or slug). Backup sidecar on-demand: exec `backup now` in the `itzg/mc-backup` container.
- CurseForge REST: base `https://api.curseforge.com`, header `x-api-key`, `GET /v1/mods/search?gameId=432&classId=4471` (432 = Minecraft, 4471 = modpacks — verify once against the live API in Task 10 and correct if the response disagrees).

---

# Part A — minecraft-stack (new project `F:\Projects\personal\minecraft-stack`)

### Task 1: Scaffold the stack project (compose file + env layout)

**Files:**
- Create: `F:\Projects\personal\minecraft-stack\docker-compose.yml`
- Create: `F:\Projects\personal\minecraft-stack\secrets.env.example`
- Create: `F:\Projects\personal\minecraft-stack\.env.example`
- Create: `F:\Projects\personal\minecraft-stack\.gitignore`
- Create: `F:\Projects\personal\minecraft-stack\README.md`
- Create: `F:\Projects\personal\minecraft-stack\DEPLOY.md`

**Interfaces:**
- Produces: compose services `mc` (container_name `minecraft`), `backup` (`minecraft-backup`), `playit` (`minecraft-playit`), `manager` (`minecraft-manager`, port 8090). Env contract consumed by the manager: `.env` holds `ACTIVE_INSTANCE`, `MC_MEMORY`, `MC_IMAGE_TAG`; `instances/<slug>/instance.env` holds `TYPE` + pack vars; `secrets.env` holds `RCON_PASSWORD`, `SECRET_KEY` (playit), `MANAGER_TOKEN` and is never rewritten by code.

- [ ] **Step 1: Create the project and compose file**

`docker-compose.yml`:

```yaml
services:
  mc:
    image: itzg/minecraft-server:${MC_IMAGE_TAG:-java21}
    container_name: minecraft
    restart: unless-stopped
    stop_grace_period: 2m
    ports:
      - "25565:25565"   # game (playit forwards to this)
      - "25575:25575"   # RCON — LAN only, never tunneled
    env_file:
      - path: ./secrets.env            # RCON_PASSWORD
      - path: ./instances/${ACTIVE_INSTANCE:-none}/instance.env
        required: false                # absent until first activate
    environment:
      EULA: "TRUE"
      MEMORY: ${MC_MEMORY:-6G}
      ENABLE_RCON: "true"
    volumes:
      - ./instances/${ACTIVE_INSTANCE:-none}/data:/data

  backup:
    image: itzg/mc-backup
    container_name: minecraft-backup
    restart: unless-stopped
    depends_on:
      - mc
    env_file:
      - ./secrets.env                  # RCON_PASSWORD (same var name both images)
    environment:
      BACKUP_INTERVAL: 24h
      INITIAL_DELAY: 5m
      PRUNE_BACKUPS_DAYS: "14"
      RCON_HOST: mc
      DEST_DIR: /backups/${ACTIVE_INSTANCE:-none}
    volumes:
      - ./instances/${ACTIVE_INSTANCE:-none}/data:/data:ro
      - ./backups:/backups

  playit:
    image: ghcr.io/playit-cloud/playit-agent:latest
    container_name: minecraft-playit
    restart: unless-stopped
    network_mode: host                 # required by the agent; reaches host-published 25565
    env_file:
      - ./secrets.env                  # SECRET_KEY

  manager:
    build: ./manager
    container_name: minecraft-manager
    restart: unless-stopped
    ports:
      - "8090:8090"
    env_file:
      - ./secrets.env                  # MANAGER_TOKEN
    environment:
      STACK_DIR: /mnt/docker/stacks/minecraft
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      # CRITICAL: mounted at the SAME path as on the host. The manager runs
      # `docker compose` against the host socket, so compose's relative bind
      # mounts (./instances/...) must resolve to real host paths.
      - /mnt/docker/stacks/minecraft:/mnt/docker/stacks/minecraft
```

- [ ] **Step 2: Create env examples and .gitignore**

`secrets.env.example`:

```bash
# Copy to secrets.env on the server. Never committed, never rewritten by the manager.
RCON_PASSWORD=change-me-long-random
SECRET_KEY=playit-agent-secret-from-playit.gg-dashboard
MANAGER_TOKEN=change-me-long-random
```

`.env.example`:

```bash
# The manager rewrites the real .env on every activate. These are first-boot defaults.
ACTIVE_INSTANCE=none
MC_MEMORY=6G
MC_IMAGE_TAG=java21
```

`.gitignore`:

```
.env
secrets.env
instances/
backups/
__pycache__/
.pytest_cache/
.venv/
```

- [ ] **Step 3: Write README.md and DEPLOY.md**

`README.md`: one screen — what the stack is, the four services, the env-file contract above (which file holds what, who writes it), and that nightwatch is the UI. `DEPLOY.md`:

```markdown
# Deploy

Target: /mnt/docker/stacks/minecraft on the home server (`ssh server`).

## First deploy
1. `git archive --format=tar HEAD | ssh server "sudo mkdir -p /mnt/docker/stacks/minecraft && sudo tar -xf - -C /mnt/docker/stacks/minecraft"`
2. On the server: `cd /mnt/docker/stacks/minecraft && sudo cp secrets.env.example secrets.env && sudo cp .env.example .env`,
   then edit secrets.env: random RCON_PASSWORD + MANAGER_TOKEN (`openssl rand -hex 24`), SECRET_KEY from playit.gg (see below).
3. `sudo docker compose up -d manager` (mc starts on first activate from nightwatch).
4. playit: create an agent at https://playit.gg → copy its secret into SECRET_KEY in
   secrets.env → `sudo docker compose up -d playit` → in the playit dashboard add a
   Minecraft Java tunnel pointing at 127.0.0.1:25565.

## Updates
Re-run step 1, then `sudo docker compose build manager && sudo docker compose up -d manager`.
`.env`, `secrets.env`, `instances/`, `backups/` live only on the server and survive updates.
```

- [ ] **Step 4: Init git and commit**

```powershell
cd F:\Projects\personal\minecraft-stack; git init; git add -A; git commit -m "feat: minecraft stack scaffold - compose, env contract, deploy docs"
```

### Task 2: mc-manager skeleton — config, auth, health endpoint

**Files:**
- Create: `minecraft-stack/manager/app/__init__.py` (empty)
- Create: `minecraft-stack/manager/app/config.py`
- Create: `minecraft-stack/manager/app/auth.py`
- Create: `minecraft-stack/manager/app/main.py`
- Create: `minecraft-stack/manager/requirements.txt`
- Create: `minecraft-stack/manager/requirements-dev.txt`
- Test: `minecraft-stack/manager/tests/test_auth.py`, `minecraft-stack/manager/tests/conftest.py`

**Interfaces:**
- Produces: `Settings` dataclass (`stack_dir: Path`, `token: str`) via `get_settings()`; FastAPI dependency `require_token`; `app` in `app.main`. All later manager tasks attach routes to this `app` and use `get_settings()`.

- [ ] **Step 1: requirements**

`requirements.txt`: `fastapi==0.115.*` and `uvicorn==0.32.*` (one per line). `requirements-dev.txt`: `-r requirements.txt`, `pytest==8.*`, `httpx==0.28.*` (httpx is what FastAPI's TestClient uses).

- [ ] **Step 2: Write failing auth test**

`tests/conftest.py`:

```python
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("MANAGER_TOKEN", "test-token")
os.environ.setdefault("STACK_DIR", "/tmp/mc-test-stack")
```

`tests/test_auth.py`:

```python
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)
AUTH = {"Authorization": "Bearer test-token"}

def test_health_requires_token():
    assert client.get("/health").status_code == 401

def test_health_rejects_wrong_token():
    assert client.get("/health", headers={"Authorization": "Bearer nope"}).status_code == 401

def test_health_ok_with_token():
    res = client.get("/health", headers=AUTH)
    assert res.status_code == 200
    assert res.json() == {"ok": True}
```

- [ ] **Step 3: Run to verify failure**

```powershell
cd F:\Projects\personal\minecraft-stack\manager
python -m venv .venv; .venv\Scripts\pip install -r requirements-dev.txt; .venv\Scripts\python -m pytest tests -v
```

Expected: FAIL (ModuleNotFoundError: app.main).

- [ ] **Step 4: Implement**

`app/config.py`:

```python
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

@dataclass(frozen=True)
class Settings:
    stack_dir: Path
    token: str

@lru_cache
def get_settings() -> Settings:
    return Settings(
        stack_dir=Path(os.environ.get("STACK_DIR", "/mnt/docker/stacks/minecraft")),
        token=os.environ["MANAGER_TOKEN"],
    )
```

`app/auth.py`:

```python
import hmac
from fastapi import Header, HTTPException
from .config import get_settings

def require_token(authorization: str = Header(default="")) -> None:
    expected = f"Bearer {get_settings().token}"
    if not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="invalid token")
```

`app/main.py`:

```python
from fastapi import Depends, FastAPI
from .auth import require_token

app = FastAPI(title="mc-manager")

@app.get("/health", dependencies=[Depends(require_token)])
def health() -> dict:
    return {"ok": True}
```

- [ ] **Step 5: Run tests → PASS, commit**

```powershell
.venv\Scripts\python -m pytest tests -v
cd F:\Projects\personal\minecraft-stack; git add -A; git commit -m "feat(manager): app skeleton with bearer-token auth and /health"
```

### Task 3: mc-manager instances — model, java tag mapping, create + list

**Files:**
- Create: `minecraft-stack/manager/app/instances.py`
- Modify: `minecraft-stack/manager/app/main.py`
- Test: `minecraft-stack/manager/tests/test_instances.py`

**Interfaces:**
- Consumes: `get_settings()` from Task 2.
- Produces (used by Tasks 4–5 and nightwatch's manager client):
  - `java_image_tag(mc_version: str) -> str`
  - `create_instance(stack_dir, *, slug, name, source, pack_ref, mc_version, memory_gb, cf_api_key) -> dict` (raises `ValueError` on bad input)
  - `list_instances(stack_dir) -> list[dict]`; `active_slug(stack_dir) -> str | None`
  - Instance JSON shape: `{"slug","name","source","packRef","mcVersion","memoryGb","createdAt"}`
  - HTTP: `GET /instances` → `{"instances":[...], "active": str|None}`; `POST /instances` body `{"slug","name","source","packRef","mcVersion","memoryGb"?,"cfApiKey"?}` → 201 with the instance dict; 409 if slug exists; 400 on validation error (curseforge without cfApiKey is a 400: "CurseForge instances need cfApiKey").

- [ ] **Step 1: Write failing tests**

`tests/test_instances.py` (uses pytest `tmp_path` as the stack dir; `client.app.dependency_overrides` is not needed — pass the dir by monkeypatching `STACK_DIR` env and clearing `get_settings.cache_clear()`):

```python
import json
from fastapi.testclient import TestClient
from app.main import app
from app.instances import java_image_tag, create_instance, list_instances, active_slug
from app.config import get_settings

client = TestClient(app)
AUTH = {"Authorization": "Bearer test-token"}

def use_stack(monkeypatch, tmp_path):
    monkeypatch.setenv("STACK_DIR", str(tmp_path))
    get_settings.cache_clear()

def test_java_image_tag_bands():
    assert java_image_tag("1.16.5") == "java8-multiarch"
    assert java_image_tag("1.18.2") == "java17"
    assert java_image_tag("1.20.4") == "java17"
    assert java_image_tag("1.20.5") == "java21"
    assert java_image_tag("1.21.1") == "java21"
    assert java_image_tag("") == "java21"          # unknown → newest

def test_create_writes_instance_files(tmp_path):
    inst = create_instance(tmp_path, slug="cobblemon", name="Cobblemon", source="modrinth",
                           pack_ref="https://modrinth.com/modpack/cobblemon-official",
                           mc_version="1.21.1", memory_gb=6, cf_api_key=None)
    meta = json.loads((tmp_path / "instances/cobblemon/instance.json").read_text())
    assert meta["slug"] == "cobblemon" and meta["source"] == "modrinth"
    env = (tmp_path / "instances/cobblemon/instance.env").read_text()
    assert "TYPE=MODRINTH" in env
    assert "MODRINTH_MODPACK=https://modrinth.com/modpack/cobblemon-official" in env
    assert (tmp_path / "instances/cobblemon/data").is_dir()
    assert inst["memoryGb"] == 6

def test_create_curseforge_requires_key(tmp_path):
    import pytest
    with pytest.raises(ValueError):
        create_instance(tmp_path, slug="atm10", name="ATM10", source="curseforge",
                        pack_ref="https://www.curseforge.com/minecraft/modpacks/all-the-mods-10",
                        mc_version="1.21.1", memory_gb=8, cf_api_key=None)

def test_create_curseforge_env(tmp_path):
    create_instance(tmp_path, slug="atm10", name="ATM10", source="curseforge",
                    pack_ref="https://www.curseforge.com/minecraft/modpacks/all-the-mods-10",
                    mc_version="1.21.1", memory_gb=8, cf_api_key="cf-key-123")
    env = (tmp_path / "instances/atm10/instance.env").read_text()
    assert "TYPE=AUTO_CURSEFORGE" in env
    assert "CF_PAGE_URL=https://www.curseforge.com/minecraft/modpacks/all-the-mods-10" in env
    assert "CF_API_KEY=cf-key-123" in env

def test_slug_validation(tmp_path):
    import pytest
    with pytest.raises(ValueError):
        create_instance(tmp_path, slug="../etc", name="x", source="modrinth",
                        pack_ref="x", mc_version="1.21", memory_gb=6, cf_api_key=None)

def test_list_and_active(tmp_path):
    assert list_instances(tmp_path) == []
    assert active_slug(tmp_path) is None
    create_instance(tmp_path, slug="a", name="A", source="modrinth", pack_ref="a",
                    mc_version="1.21.1", memory_gb=6, cf_api_key=None)
    (tmp_path / ".env").write_text("ACTIVE_INSTANCE=a\nMC_MEMORY=6G\nMC_IMAGE_TAG=java21\n")
    assert [i["slug"] for i in list_instances(tmp_path)] == ["a"]
    assert active_slug(tmp_path) == "a"

def test_http_create_and_list(monkeypatch, tmp_path):
    use_stack(monkeypatch, tmp_path)
    body = {"slug": "cobblemon", "name": "Cobblemon", "source": "modrinth",
            "packRef": "cobblemon-official", "mcVersion": "1.21.1"}
    assert client.post("/instances", json=body, headers=AUTH).status_code == 201
    assert client.post("/instances", json=body, headers=AUTH).status_code == 409
    res = client.get("/instances", headers=AUTH)
    assert res.status_code == 200
    assert res.json()["instances"][0]["slug"] == "cobblemon"
```

- [ ] **Step 2: Run → FAIL** (`ImportError`). `.venv\Scripts\python -m pytest tests -v`

- [ ] **Step 3: Implement `app/instances.py`**

```python
import json
import re
from datetime import datetime, timezone
from pathlib import Path

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-_]{1,63}$")

def java_image_tag(mc_version: str) -> str:
    m = re.match(r"^1\.(\d+)(?:\.(\d+))?", mc_version or "")
    if not m:
        return "java21"
    minor, patch = int(m.group(1)), int(m.group(2) or 0)
    if minor <= 16:
        return "java8-multiarch"
    if minor < 20 or (minor == 20 and patch < 5):
        return "java17" if minor >= 17 else "java8-multiarch"
    return "java21"

def _instance_env(source: str, pack_ref: str, cf_api_key: str | None) -> str:
    if source == "curseforge":
        return f"TYPE=AUTO_CURSEFORGE\nCF_PAGE_URL={pack_ref}\nCF_API_KEY={cf_api_key}\n"
    return f"TYPE=MODRINTH\nMODRINTH_MODPACK={pack_ref}\n"

def create_instance(stack_dir: Path, *, slug: str, name: str, source: str, pack_ref: str,
                    mc_version: str, memory_gb: int, cf_api_key: str | None) -> dict:
    if not SLUG_RE.match(slug):
        raise ValueError("slug must be lowercase letters, digits, - or _")
    if source not in ("curseforge", "modrinth"):
        raise ValueError("source must be curseforge or modrinth")
    if not pack_ref.strip():
        raise ValueError("packRef is required")
    if source == "curseforge" and not cf_api_key:
        raise ValueError("CurseForge instances need cfApiKey")
    inst_dir = stack_dir / "instances" / slug
    if inst_dir.exists():
        raise FileExistsError(slug)
    meta = {
        "slug": slug, "name": name, "source": source, "packRef": pack_ref,
        "mcVersion": mc_version, "memoryGb": memory_gb,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    (inst_dir / "data").mkdir(parents=True)
    (inst_dir / "instance.json").write_text(json.dumps(meta, indent=2))
    (inst_dir / "instance.env").write_text(_instance_env(source, pack_ref, cf_api_key))
    return meta

def list_instances(stack_dir: Path) -> list[dict]:
    root = stack_dir / "instances"
    out = []
    if root.is_dir():
        for meta_file in sorted(root.glob("*/instance.json")):
            try:
                out.append(json.loads(meta_file.read_text()))
            except (OSError, json.JSONDecodeError):
                continue
    return out

def active_slug(stack_dir: Path) -> str | None:
    env = stack_dir / ".env"
    if not env.is_file():
        return None
    for line in env.read_text().splitlines():
        if line.startswith("ACTIVE_INSTANCE="):
            value = line.split("=", 1)[1].strip()
            return value if value and value != "none" else None
    return None

def write_root_env(stack_dir: Path, slug: str, memory_gb: int, image_tag: str) -> None:
    (stack_dir / ".env").write_text(
        f"ACTIVE_INSTANCE={slug}\nMC_MEMORY={memory_gb}G\nMC_IMAGE_TAG={image_tag}\n"
    )
```

Wire into `app/main.py` (add to existing file):

```python
from fastapi import Body, HTTPException
from .config import get_settings
from . import instances as inst

@app.get("/instances", dependencies=[Depends(require_token)])
def get_instances() -> dict:
    stack = get_settings().stack_dir
    return {"instances": inst.list_instances(stack), "active": inst.active_slug(stack)}

@app.post("/instances", status_code=201, dependencies=[Depends(require_token)])
def post_instance(body: dict = Body(...)) -> dict:
    stack = get_settings().stack_dir
    try:
        return inst.create_instance(
            stack,
            slug=str(body.get("slug", "")), name=str(body.get("name", "")),
            source=str(body.get("source", "")), pack_ref=str(body.get("packRef", "")),
            mc_version=str(body.get("mcVersion", "")),
            memory_gb=int(body.get("memoryGb") or 6),
            cf_api_key=body.get("cfApiKey"),
        )
    except FileExistsError:
        raise HTTPException(status_code=409, detail="instance already exists")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
```

- [ ] **Step 4: Run tests → PASS.** `.venv\Scripts\python -m pytest tests -v`

- [ ] **Step 5: Commit** — `git add -A; git commit -m "feat(manager): instance model, java tag mapping, create/list endpoints"`

### Task 4: mc-manager activate — compose wrapper + switch sequence

**Files:**
- Create: `minecraft-stack/manager/app/compose.py`
- Modify: `minecraft-stack/manager/app/main.py`
- Test: `minecraft-stack/manager/tests/test_activate.py`

**Interfaces:**
- Consumes: `active_slug`, `write_root_env`, `java_image_tag`, instance metadata from Task 3.
- Produces: `ComposeRunner` class with `run(*args) -> str` (subprocess) — module-level `runner` instance swapped out in tests; `POST /instances/{slug}/activate` → `{"ok": true, "active": slug}`, 404 unknown slug (re-activating the active slug just recreates it — harmless and useful as a "reinstall"). Sequence contract (tested): `rm -sf mc backup` → write `.env` → `up -d mc backup`.

- [ ] **Step 1: Write failing tests**

`tests/test_activate.py`:

```python
from fastapi.testclient import TestClient
from app.main import app
from app import compose
from app.config import get_settings
from app.instances import create_instance

client = TestClient(app)
AUTH = {"Authorization": "Bearer test-token"}

class FakeRunner:
    def __init__(self):
        self.calls = []
    def run(self, *args):
        self.calls.append(list(args))
        return ""

def setup_stack(monkeypatch, tmp_path):
    monkeypatch.setenv("STACK_DIR", str(tmp_path))
    get_settings.cache_clear()
    fake = FakeRunner()
    monkeypatch.setattr(compose, "runner", fake)
    create_instance(tmp_path, slug="cobblemon", name="C", source="modrinth",
                    pack_ref="cobblemon-official", mc_version="1.21.1",
                    memory_gb=6, cf_api_key=None)
    return fake

def test_activate_sequence(monkeypatch, tmp_path):
    fake = setup_stack(monkeypatch, tmp_path)
    res = client.post("/instances/cobblemon/activate", headers=AUTH)
    assert res.status_code == 200
    assert res.json() == {"ok": True, "active": "cobblemon"}
    assert fake.calls == [
        ["rm", "-sf", "mc", "backup"],
        ["up", "-d", "mc", "backup"],
    ]
    env = (tmp_path / ".env").read_text()
    assert "ACTIVE_INSTANCE=cobblemon" in env
    assert "MC_MEMORY=6G" in env
    assert "MC_IMAGE_TAG=java21" in env

def test_activate_unknown_404(monkeypatch, tmp_path):
    setup_stack(monkeypatch, tmp_path)
    assert client.post("/instances/nope/activate", headers=AUTH).status_code == 404
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

`app/compose.py`:

```python
import subprocess
from .config import get_settings

class ComposeError(RuntimeError):
    pass

class ComposeRunner:
    def run(self, *args: str) -> str:
        proc = subprocess.run(
            ["docker", "compose", *args],
            cwd=get_settings().stack_dir, capture_output=True, text=True, timeout=300,
        )
        if proc.returncode != 0:
            raise ComposeError(proc.stderr.strip() or f"docker compose {' '.join(args)} failed")
        return proc.stdout

runner = ComposeRunner()

def mc_running() -> bool:
    try:
        out = runner.run("ps", "--status", "running", "--services")
    except ComposeError:
        return False
    return "mc" in out.split()
```

In `app/main.py`:

```python
import json
from . import compose

@app.post("/instances/{slug}/activate", dependencies=[Depends(require_token)])
def activate(slug: str) -> dict:
    stack = get_settings().stack_dir
    meta_file = stack / "instances" / slug / "instance.json"
    if not meta_file.is_file():
        raise HTTPException(status_code=404, detail="unknown instance")
    meta = json.loads(meta_file.read_text())
    try:
        compose.runner.run("rm", "-sf", "mc", "backup")
        inst.write_root_env(stack, slug, int(meta.get("memoryGb") or 6),
                            inst.java_image_tag(meta.get("mcVersion", "")))
        compose.runner.run("up", "-d", "mc", "backup")
    except compose.ComposeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"ok": True, "active": slug}
```

- [ ] **Step 4: Run tests → PASS. Commit** — `git add -A; git commit -m "feat(manager): activate endpoint with compose rm/up sequence"`

### Task 5: mc-manager backups + instance delete

**Files:**
- Create: `minecraft-stack/manager/app/backups.py`
- Modify: `minecraft-stack/manager/app/main.py`
- Test: `minecraft-stack/manager/tests/test_backups.py`

**Interfaces:**
- Consumes: `compose.runner`, `compose.mc_running`, `active_slug` from earlier tasks.
- Produces HTTP contract (consumed by nightwatch client in Task 11):
  - `GET /backups` → `{"backups": [{"instance","file","sizeBytes","modifiedAt"}]}` (all instances, newest first)
  - `POST /backups/run` → `{"ok": true}`; 409 if mc not running (mc-backup needs RCON)
  - `POST /backups/restore` body `{"instance","file"}` → `{"ok": true}`; 409 if mc running; 404 unknown file; renames current data dir to `data.pre-restore-<utcstamp>` then extracts
  - `DELETE /instances/{slug}` → `{"ok": true}`; 409 if active; takes `final-<utcstamp>.tgz` into `backups/<slug>/` before removing

- [ ] **Step 1: Write failing tests**

`tests/test_backups.py`:

```python
import tarfile
from fastapi.testclient import TestClient
from app.main import app
from app import compose
from app.config import get_settings
from app.instances import create_instance

client = TestClient(app)
AUTH = {"Authorization": "Bearer test-token"}

class FakeRunner:
    def __init__(self, running=False):
        self.calls = []
        self.running = running
    def run(self, *args):
        self.calls.append(list(args))
        if list(args)[:3] == ["ps", "--status", "running"]:
            return "mc\n" if self.running else ""
        return ""

def setup_stack(monkeypatch, tmp_path, running=False):
    monkeypatch.setenv("STACK_DIR", str(tmp_path))
    get_settings.cache_clear()
    fake = FakeRunner(running=running)
    monkeypatch.setattr(compose, "runner", fake)
    create_instance(tmp_path, slug="a", name="A", source="modrinth", pack_ref="a",
                    mc_version="1.21.1", memory_gb=6, cf_api_key=None)
    return fake

def make_backup(tmp_path, instance, name="b1.tgz", member="world/level.dat"):
    dest = tmp_path / "backups" / instance
    dest.mkdir(parents=True, exist_ok=True)
    src = tmp_path / "srcfile"
    src.write_text("data")
    with tarfile.open(dest / name, "w:gz") as tar:
        tar.add(src, arcname=member)
    return dest / name

def test_list_backups(monkeypatch, tmp_path):
    setup_stack(monkeypatch, tmp_path)
    make_backup(tmp_path, "a")
    res = client.get("/backups", headers=AUTH)
    assert res.status_code == 200
    assert res.json()["backups"][0]["instance"] == "a"
    assert res.json()["backups"][0]["file"] == "b1.tgz"

def test_run_backup_requires_running_mc(monkeypatch, tmp_path):
    setup_stack(monkeypatch, tmp_path, running=False)
    assert client.post("/backups/run", headers=AUTH).status_code == 409

def test_run_backup_execs_backup_now(monkeypatch, tmp_path):
    fake = setup_stack(monkeypatch, tmp_path, running=True)
    assert client.post("/backups/run", headers=AUTH).status_code == 200
    assert ["exec", "-T", "backup", "backup", "now"] in fake.calls

def test_restore_refuses_while_running(monkeypatch, tmp_path):
    setup_stack(monkeypatch, tmp_path, running=True)
    make_backup(tmp_path, "a")
    res = client.post("/backups/restore", json={"instance": "a", "file": "b1.tgz"}, headers=AUTH)
    assert res.status_code == 409

def test_restore_extracts_and_preserves_old(monkeypatch, tmp_path):
    setup_stack(monkeypatch, tmp_path, running=False)
    make_backup(tmp_path, "a")
    (tmp_path / "instances/a/data/old.txt").write_text("old")
    res = client.post("/backups/restore", json={"instance": "a", "file": "b1.tgz"}, headers=AUTH)
    assert res.status_code == 200
    assert (tmp_path / "instances/a/data/world/level.dat").is_file()
    pre = list((tmp_path / "instances/a").glob("data.pre-restore-*"))
    assert len(pre) == 1 and (pre[0] / "old.txt").is_file()

def test_restore_rejects_traversal(monkeypatch, tmp_path):
    setup_stack(monkeypatch, tmp_path, running=False)
    res = client.post("/backups/restore", json={"instance": "a", "file": "../../../etc"}, headers=AUTH)
    assert res.status_code == 404

def test_delete_refuses_active(monkeypatch, tmp_path):
    setup_stack(monkeypatch, tmp_path)
    (tmp_path / ".env").write_text("ACTIVE_INSTANCE=a\n")
    assert client.delete("/instances/a", headers=AUTH).status_code == 409

def test_delete_takes_final_backup(monkeypatch, tmp_path):
    setup_stack(monkeypatch, tmp_path)
    (tmp_path / "instances/a/data/world.txt").write_text("w")
    assert client.delete("/instances/a", headers=AUTH).status_code == 200
    assert not (tmp_path / "instances/a").exists()
    finals = list((tmp_path / "backups/a").glob("final-*.tgz"))
    assert len(finals) == 1
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `app/backups.py`**

```python
import shutil
import tarfile
from datetime import datetime, timezone
from pathlib import Path

def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

def list_backups(stack_dir: Path) -> list[dict]:
    root = stack_dir / "backups"
    out = []
    if root.is_dir():
        for f in root.glob("*/*.tgz"):
            stat = f.stat()
            out.append({
                "instance": f.parent.name, "file": f.name,
                "sizeBytes": stat.st_size,
                "modifiedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
            })
    out.sort(key=lambda b: b["modifiedAt"], reverse=True)
    return out

def resolve_backup(stack_dir: Path, instance: str, file: str) -> Path | None:
    candidate = (stack_dir / "backups" / instance / file).resolve()
    root = (stack_dir / "backups").resolve()
    if not candidate.is_file() or root not in candidate.parents:
        return None
    return candidate

def restore(stack_dir: Path, instance: str, backup_file: Path) -> None:
    data_dir = stack_dir / "instances" / instance / "data"
    if data_dir.exists():
        data_dir.rename(data_dir.parent / f"data.pre-restore-{_stamp()}")
    data_dir.mkdir(parents=True)
    with tarfile.open(backup_file, "r:gz") as tar:
        tar.extractall(data_dir, filter="data")   # 'data' filter blocks path escapes

def final_backup_and_delete(stack_dir: Path, slug: str) -> None:
    inst_dir = stack_dir / "instances" / slug
    dest = stack_dir / "backups" / slug
    dest.mkdir(parents=True, exist_ok=True)
    data_dir = inst_dir / "data"
    if data_dir.is_dir():
        with tarfile.open(dest / f"final-{_stamp()}.tgz", "w:gz") as tar:
            for child in data_dir.iterdir():
                tar.add(child, arcname=child.name)
    shutil.rmtree(inst_dir)
```

In `app/main.py`:

```python
from fastapi import Body
from . import backups as bk

@app.get("/backups", dependencies=[Depends(require_token)])
def get_backups() -> dict:
    return {"backups": bk.list_backups(get_settings().stack_dir)}

@app.post("/backups/run", dependencies=[Depends(require_token)])
def run_backup() -> dict:
    if not compose.mc_running():
        raise HTTPException(status_code=409, detail="server is not running")
    try:
        compose.runner.run("exec", "-T", "backup", "backup", "now")
    except compose.ComposeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"ok": True}

@app.post("/backups/restore", dependencies=[Depends(require_token)])
def restore_backup(body: dict = Body(...)) -> dict:
    stack = get_settings().stack_dir
    if compose.mc_running():
        raise HTTPException(status_code=409, detail="stop the server before restoring")
    backup_file = bk.resolve_backup(stack, str(body.get("instance", "")), str(body.get("file", "")))
    if backup_file is None:
        raise HTTPException(status_code=404, detail="unknown backup file")
    bk.restore(stack, str(body["instance"]), backup_file)
    return {"ok": True}

@app.delete("/instances/{slug}", dependencies=[Depends(require_token)])
def delete_instance(slug: str) -> dict:
    stack = get_settings().stack_dir
    if not (stack / "instances" / slug / "instance.json").is_file():
        raise HTTPException(status_code=404, detail="unknown instance")
    if inst.active_slug(stack) == slug:
        raise HTTPException(status_code=409, detail="deactivate before deleting")
    bk.final_backup_and_delete(stack, slug)
    return {"ok": True}
```

- [ ] **Step 4: Run full manager suite → PASS. Commit** — `git add -A; git commit -m "feat(manager): backups list/run/restore and guarded instance delete"`

### Task 6: Manager Dockerfile, deploy to server, live smoke test

**Files:**
- Create: `minecraft-stack/manager/Dockerfile`
- Create: `minecraft-stack/manager/.dockerignore`

**Interfaces:**
- Consumes: everything in Tasks 1–5.
- Produces: `minecraft-manager` live at `http://<server>:8090`, verified end-to-end with a real Modrinth pack.

- [ ] **Step 1: Dockerfile**

```dockerfile
FROM python:3.12-alpine
RUN apk add --no-cache docker-cli docker-cli-compose
WORKDIR /srv/manager
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
EXPOSE 8090
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090"]
```

`.dockerignore`: `tests/`, `.venv/`, `__pycache__/`, `.pytest_cache/`.

- [ ] **Step 2: Deploy per DEPLOY.md** — archive to `/mnt/docker/stacks/minecraft`, create `secrets.env` (random `RCON_PASSWORD` + `MANAGER_TOKEN` via `openssl rand -hex 24`; `SECRET_KEY` can stay a placeholder until the owner does the playit step), copy `.env.example` → `.env`, `sudo docker compose build manager && sudo docker compose up -d manager`.

- [ ] **Step 3: Smoke test over LAN** (from the dev machine; real host/token from `.claude/local-env.md`):

```powershell
curl -H "Authorization: Bearer <MANAGER_TOKEN>" http://<server>:8090/health          # → {"ok":true}
curl -H "Authorization: Bearer <MANAGER_TOKEN>" http://<server>:8090/instances      # → {"instances":[],"active":null}
```

- [ ] **Step 4: Real activation smoke** — create + activate a Modrinth pack (`cobblemon-official`, or any current server-supported modpack slug if that one has moved):

```powershell
curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" `
  -d '{"slug":"cobblemon","name":"Cobblemon","source":"modrinth","packRef":"https://modrinth.com/modpack/cobblemon-official","mcVersion":"1.21.1","memoryGb":6}' `
  http://<server>:8090/instances
curl -X POST -H "Authorization: Bearer <token>" http://<server>:8090/instances/cobblemon/activate
ssh server "sudo docker logs -f minecraft"   # watch until 'Done (X.XXXs)! For help, type "help"' — first boot takes minutes
```

Acceptance: `Done` line appears; `ssh server "sudo docker exec minecraft rcon-cli list"` answers with a player count line.

- [ ] **Step 5: Commit** — `git add -A; git commit -m "feat(manager): dockerfile; stack deployed and smoke-tested"`

**OWNER-BLOCKED (record in task board, do not block later tasks):** playit.gg agent secret → `SECRET_KEY` in `secrets.env`, `docker compose up -d playit`, add a Java tunnel → `127.0.0.1:25565` in the playit dashboard.

---

# Part B — nightwatch (repo `F:\Projects\personal\homelab-dashboard`)

### Task 7: Branch setup + config block + settings API + settings panel

**Files:**
- Modify: `src/lib/config.ts` (AppConfig)
- Modify: `src/app/api/settings/integrations/route.ts`
- Modify: `src/components/settings/settings-integrations.tsx`
- Modify: `src/app/(dash)/settings/page.tsx` (render the new panel — mirror how NpmPanel is mounted)
- Modify: `src/app/api/settings/full/route.ts` or wherever `SettingsFullResponse.integrations` is assembled — add `minecraft` (find the file by grepping for `integrations.npm`; extend the same object)

**Interfaces:**
- Produces: `AppConfig.minecraft` block (below) — every later nightwatch task reads it via `loadConfig().minecraft`.

```ts
minecraft?: {
  managerUrl?: string;      // http://192.168.1.70:8090
  managerToken?: string;    // secret
  curseforgeKey?: string;   // secret
  rconHost?: string;        // 192.168.1.70
  rconPort?: number;        // 25575
  rconPassword?: string;    // secret
  updatedAt?: string;
};
```

- [ ] **Step 1: Branch.** `git -c safe.directory=* checkout main; git -c safe.directory=* checkout -b feature/minecraft; git -c safe.directory=* cherry-pick 079e4b0` (the spec commit on feature/ac-auto-off; also copy this plan file onto the branch and commit it if the cherry-pick doesn't include it).

- [ ] **Step 2: Add the block to `AppConfig`** in `src/lib/config.ts` (after `forgejo`, same optional-fields style, with the doc comment `/** Minecraft stack: mc-manager API + RCON + CurseForge search key. */`).

- [ ] **Step 3: Extend the settings route.** In `src/app/api/settings/integrations/route.ts`: add `minecraft?: Patch | null` to `Body` (extend `Patch` with `managerUrl/managerToken/curseforgeKey/rconHost/rconPort/rconPassword` as `unknown` fields), and a block mirroring the `npm` one:

```ts
if ("minecraft" in body) {
  if (body.minecraft === null) {
    delete next.minecraft;
  } else if (body.minecraft) {
    const managerUrl = str(body.minecraft.managerUrl) ?? current.minecraft?.managerUrl;
    const managerToken = mergedSecret(str(body.minecraft.managerToken), current.minecraft?.managerToken);
    const curseforgeKey = mergedSecret(str(body.minecraft.curseforgeKey), current.minecraft?.curseforgeKey);
    const rconHost = str(body.minecraft.rconHost) ?? current.minecraft?.rconHost;
    const rconPortRaw = body.minecraft.rconPort;
    const rconPort =
      typeof rconPortRaw === "number" && Number.isInteger(rconPortRaw)
        ? rconPortRaw
        : current.minecraft?.rconPort ?? 25575;
    const rconPassword = mergedSecret(str(body.minecraft.rconPassword), current.minecraft?.rconPassword);
    if (!managerUrl) return NextResponse.json({ error: "Minecraft needs the manager URL" }, { status: 400 });
    if (!managerToken) return NextResponse.json({ error: "Minecraft needs the manager token" }, { status: 400 });
    next.minecraft = { managerUrl, managerToken, curseforgeKey, rconHost, rconPort, rconPassword, updatedAt: now };
  }
}
```

Add to the response object: `minecraft: { configured: Boolean(next.minecraft?.managerToken), updatedAt: next.minecraft?.updatedAt }` — and the same key wherever `SettingsFullResponse.integrations` is built.

- [ ] **Step 4: Settings panel.** In `settings-integrations.tsx`, add `MinecraftPanel` cloned from `NpmPanel`: non-secret fields Manager URL (`Input`, placeholder `http://192.168.1.70:8090`), RCON host (placeholder `192.168.1.70`), RCON port (placeholder `25575`, parse with `Number()` before save); `SecretField`s for Manager token, CurseForge API key, RCON password; save via `save("minecraft", { managerUrl, rconHost, rconPort: Number(rconPort) || undefined, managerToken: managerToken || undefined, curseforgeKey: curseforgeKey || undefined, rconPassword: rconPassword || undefined })`; `ClearControl` label "Minecraft". Mount it in the settings page next to the other integration panels. Helper text: "mc-manager runs in the minecraft stack; token is MANAGER_TOKEN in its secrets.env. CurseForge key is optional — Modrinth search works without it."

- [ ] **Step 5: Verify + commit.** `npx tsc --noEmit && npm run build` → clean. `git -c safe.directory=* add -A; git -c safe.directory=* commit -m "feat(minecraft): config block, settings API and panel"`

### Task 8: Hand-rolled RCON client

**Files:**
- Create: `src/lib/minecraft/rcon.ts`
- Test: `src/lib/minecraft/rcon.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 9/12):
  - `encodePacket(id: number, type: number, payload: string): Buffer`
  - `decodePackets(buf: Buffer): { packets: { id: number; type: number; payload: string }[]; rest: Buffer }`
  - `rconCommand(opts: { host: string; port: number; password: string; command: string; timeoutMs?: number }): Promise<string>` — rejects with `Error("rcon auth failed")` on bad password, `Error("rcon unreachable")` on connect/timeout errors
  - `parsePlayerList(text: string): { online: number; max: number; players: string[] } | null`

- [ ] **Step 1: Write failing tests** — `src/lib/minecraft/rcon.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodePacket, decodePackets, parsePlayerList } from "./rcon.ts";

describe("rcon packets", () => {
  it("round-trips a packet", () => {
    const buf = encodePacket(7, 2, "list");
    // length prefix = 4 (id) + 4 (type) + payload + 2 null terminators
    assert.equal(buf.readInt32LE(0), 4 + 4 + 4 + 2);
    const { packets, rest } = decodePackets(buf);
    assert.equal(rest.length, 0);
    assert.deepEqual(packets, [{ id: 7, type: 2, payload: "list" }]);
  });

  it("decodes two concatenated packets and keeps a partial tail", () => {
    const two = Buffer.concat([encodePacket(1, 0, "a"), encodePacket(2, 0, "b")]);
    const withTail = Buffer.concat([two, Buffer.from([9, 0])]);
    const { packets, rest } = decodePackets(withTail);
    assert.equal(packets.length, 2);
    assert.equal(packets[1].payload, "b");
    assert.equal(rest.length, 2);
  });
});

describe("parsePlayerList", () => {
  it("parses the vanilla list format", () => {
    assert.deepEqual(
      parsePlayerList("There are 2 of a max of 20 players online: Alice, Bob"),
      { online: 2, max: 20, players: ["Alice", "Bob"] },
    );
  });
  it("parses an empty server", () => {
    assert.deepEqual(
      parsePlayerList("There are 0 of a max of 20 players online: "),
      { online: 0, max: 20, players: [] },
    );
  });
  it("returns null on unrecognized text", () => {
    assert.equal(parsePlayerList("Unknown command"), null);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npm test` (module not found).

- [ ] **Step 3: Implement `src/lib/minecraft/rcon.ts`**

```ts
import net from "node:net";

// Source RCON framing: [int32 LE length][int32 LE id][int32 LE type][payload][\0\0]
// type 3 = login, 2 = command, 0 = response. Login failure echoes id -1.

export function encodePacket(id: number, type: number, payload: string): Buffer {
  const body = Buffer.from(payload, "utf8");
  const buf = Buffer.alloc(4 + 4 + 4 + body.length + 2);
  buf.writeInt32LE(4 + 4 + body.length + 2, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  body.copy(buf, 12);
  return buf;
}

export function decodePackets(buf: Buffer): {
  packets: { id: number; type: number; payload: string }[];
  rest: Buffer;
} {
  const packets: { id: number; type: number; payload: string }[] = [];
  let offset = 0;
  while (buf.length - offset >= 4) {
    const length = buf.readInt32LE(offset);
    if (buf.length - offset - 4 < length) break;
    packets.push({
      id: buf.readInt32LE(offset + 4),
      type: buf.readInt32LE(offset + 8),
      payload: buf.subarray(offset + 12, offset + 4 + length - 2).toString("utf8"),
    });
    offset += 4 + length;
  }
  return { packets, rest: buf.subarray(offset) };
}

const LOGIN = 3;
const COMMAND = 2;

export function rconCommand(opts: {
  host: string;
  port: number;
  password: string;
  command: string;
  timeoutMs?: number;
}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 4000;
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: opts.host, port: opts.port });
    let pending = Buffer.alloc(0);
    let authed = false;
    const responses: string[] = [];
    let settleTimer: NodeJS.Timeout | null = null;
    const overall = setTimeout(() => fail(new Error("rcon unreachable")), timeoutMs);

    function done(value: string) {
      clearTimeout(overall);
      if (settleTimer) clearTimeout(settleTimer);
      socket.destroy();
      resolve(value);
    }
    function fail(err: Error) {
      clearTimeout(overall);
      if (settleTimer) clearTimeout(settleTimer);
      socket.destroy();
      reject(err);
    }

    socket.on("error", () => fail(new Error("rcon unreachable")));
    socket.on("connect", () => socket.write(encodePacket(1, LOGIN, opts.password)));
    socket.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      const { packets, rest } = decodePackets(pending);
      pending = rest;
      for (const p of packets) {
        if (!authed) {
          if (p.id === -1) return fail(new Error("rcon auth failed"));
          authed = true;
          socket.write(encodePacket(2, COMMAND, opts.command));
        } else {
          responses.push(p.payload);
          // Responses can span packets; settle 150ms after the last one.
          if (settleTimer) clearTimeout(settleTimer);
          settleTimer = setTimeout(() => done(responses.join("")), 150);
        }
      }
    });
  });
}

const LIST_RE = /There are (\d+) of a max of (\d+) players online:\s*(.*)/;

export function parsePlayerList(
  text: string,
): { online: number; max: number; players: string[] } | null {
  const m = LIST_RE.exec(text);
  if (!m) return null;
  const players = m[3].split(",").map((s) => s.trim()).filter(Boolean);
  return { online: Number(m[1]), max: Number(m[2]), players };
}
```

- [ ] **Step 4: Run → PASS.** `npm test`

- [ ] **Step 5: Commit** — `git -c safe.directory=* add src/lib/minecraft; git -c safe.directory=* commit -m "feat(minecraft): hand-rolled rcon client with packet codec tests"`

### Task 9: Pack search — CurseForge + Modrinth normalizers and fetchers

**Files:**
- Create: `src/lib/minecraft/packs.ts`
- Test: `src/lib/minecraft/packs.test.ts`

**Interfaces:**
- Produces (consumed by Task 12's search route and Task 13's browser UI):

```ts
export interface PackResult {
  source: "curseforge" | "modrinth";
  id: string;
  slug: string;
  name: string;
  summary: string;
  icon: string | null;
  downloads: number;
  mcVersion: string | null;   // newest supported MC version — sent to the manager for java tag mapping
  loader: string | null;      // "forge" | "fabric" | "neoforge" | "quilt" | null
  pageUrl: string;            // becomes the manager's packRef
}
export function normalizeCurseforge(json: unknown): PackResult[];
export function normalizeModrinth(json: unknown): PackResult[];
export function searchPacks(q: string, source: "all" | "curseforge" | "modrinth"): Promise<{
  results: PackResult[];
  curseforge: "ok" | "no-key" | "error";
  modrinth: "ok" | "error";
}>;
```

- [ ] **Step 1: Write failing tests** for the two normalizers with realistic fixture objects (build fixtures from the documented shapes — CF: `{data: [{id, slug, name, summary, downloadCount, logo: {url}, latestFilesIndexes: [{gameVersion, modLoader}]}]}` with modLoader enum 1=forge, 4=fabric, 5=quilt, 6=neoforge; Modrinth: `{hits: [{project_id, slug, title, description, icon_url, downloads, versions: [...], categories: [...]}]}` where loader = first of `["forge","fabric","neoforge","quilt"]` found in `categories` and mcVersion = last entry of `versions`). Assert: normalized fields map correctly, missing logo → `icon: null`, empty input → `[]`, malformed input (not an object) → `[]`.

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeCurseforge, normalizeModrinth } from "./packs.ts";

describe("normalizeCurseforge", () => {
  it("maps the documented shape", () => {
    const out = normalizeCurseforge({
      data: [{
        id: 925200, slug: "all-the-mods-10", name: "All The Mods 10",
        summary: "ATM10", downloadCount: 1000000,
        logo: { url: "https://cdn/logo.png" },
        links: { websiteUrl: "https://www.curseforge.com/minecraft/modpacks/all-the-mods-10" },
        latestFilesIndexes: [{ gameVersion: "1.21.1", modLoader: 6 }],
      }],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].source, "curseforge");
    assert.equal(out[0].loader, "neoforge");
    assert.equal(out[0].mcVersion, "1.21.1");
    assert.equal(out[0].pageUrl, "https://www.curseforge.com/minecraft/modpacks/all-the-mods-10");
  });
  it("tolerates junk", () => {
    assert.deepEqual(normalizeCurseforge(null), []);
    assert.deepEqual(normalizeCurseforge({ data: [{}] })[0].icon, null);
  });
});

describe("normalizeModrinth", () => {
  it("maps the documented shape", () => {
    const out = normalizeModrinth({
      hits: [{
        project_id: "abc", slug: "cobblemon-official", title: "Cobblemon",
        description: "Pokemon", icon_url: "https://cdn/i.png", downloads: 5,
        versions: ["1.20.1", "1.21.1"], categories: ["adventure", "fabric"],
      }],
    });
    assert.equal(out[0].loader, "fabric");
    assert.equal(out[0].mcVersion, "1.21.1");
    assert.equal(out[0].pageUrl, "https://modrinth.com/modpack/cobblemon-official");
  });
  it("tolerates junk", () => {
    assert.deepEqual(normalizeModrinth(undefined), []);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** Normalizers are defensive pure functions over `unknown` (guard every access; CF `pageUrl` falls back to `https://www.curseforge.com/minecraft/modpacks/<slug>` when `links.websiteUrl` is absent). `searchPacks` reads `loadConfig().minecraft?.curseforgeKey`, fires both fetches concurrently with `AbortSignal.timeout(6000)` and `cache: "no-store"`:
  - CF (only when key present, else `curseforge: "no-key"`): `GET https://api.curseforge.com/v1/mods/search?gameId=432&classId=4471&searchFilter=<enc q>&sortField=2&sortOrder=desc&pageSize=20`, header `x-api-key`.
  - Modrinth: `GET https://api.modrinth.com/v2/search?query=<enc q>&facets=${encodeURIComponent('[["project_type:modpack"]]')}&limit=20`.
  - Each side degrades to `"error"` independently (mirror `forgejoFetch`'s try/catch classification); `results` = successful sides' normalized lists interleaved CF-first, filtered by `source` param.

- [ ] **Step 4: Run → PASS. Verify the live constants once:** `curl -H "x-api-key: <key>" "https://api.curseforge.com/v1/mods/search?gameId=432&classId=4471&searchFilter=all+the+mods&pageSize=3"` should return modpacks (use the owner's key if it has landed; if not, note it in the task board and move on — Modrinth path is verified by `curl "https://api.modrinth.com/v2/search?query=cobblemon&facets=%5B%5B%22project_type%3Amodpack%22%5D%5D&limit=3"`). If CF disagrees with 432/4471, fix the constants and this plan's Global Constraints line.

- [ ] **Step 5: Commit** — `git -c safe.directory=* add -A; git -c safe.directory=* commit -m "feat(minecraft): pack search with curseforge+modrinth normalizers"`

### Task 10: Manager client (IntegrationClient subclass)

**Files:**
- Create: `src/lib/minecraft/manager.ts`
- Test: `src/lib/minecraft/manager.test.ts`

**Interfaces:**
- Consumes: `IntegrationClient`, `Probe<T>`, `isProbeOk` from `src/lib/integration-client.ts`; `loadConfig` from `src/lib/config.ts`; manager HTTP contract from Tasks 3–5.
- Produces (consumed by Task 12 routes):

```ts
export interface McInstance { slug: string; name: string; source: "curseforge" | "modrinth"; packRef: string; mcVersion: string; memoryGb: number; createdAt: string; }
export interface McBackup { instance: string; file: string; sizeBytes: number; modifiedAt: string; }
export class McManagerClient extends IntegrationClient<{ url: string; token: string }> {
  instances(): Promise<Probe<{ instances: McInstance[]; active: string | null }>>;
  createInstance(body: { slug: string; name: string; source: string; packRef: string; mcVersion: string; memoryGb?: number; cfApiKey?: string }): Promise<Probe<McInstance>>;
  activate(slug: string): Promise<Probe<{ ok: true; active: string }>>;
  deleteInstance(slug: string): Promise<Probe<{ ok: true }>>;
  backups(): Promise<Probe<{ backups: McBackup[] }>>;
  runBackup(): Promise<Probe<{ ok: true }>>;
  restoreBackup(instance: string, file: string): Promise<Probe<{ ok: true }>>;
}
export const mcManager: McManagerClient;  // module singleton
```

- [ ] **Step 1: Write failing tests** modeled on `src/lib/integration-client.test.ts`'s `TestClient` approach (mock `globalThis.fetch`, restore in `afterEach`): credentials come from `loadConfig()` — set `DATA_DIR` to a temp dir and write a `config.json` with a `minecraft` block, or (simpler, matching the existing test file's style) subclass locally overriding `credentials()`. Test: unconfigured → probe `{status:"unconfigured"}` without fetching; 401 from manager → `"unauthorized"`; happy path `instances()` hits `<url>/instances` with header `Authorization: Bearer <token>` and returns data.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `displayName = "mc-manager"`, `timeoutMs = 6000`, `unconfiguredDetail = "Minecraft manager is not configured — add managerUrl and managerToken in Settings → Integrations."`; `credentials()` reads `loadConfig().minecraft` (both `managerUrl` and `managerToken` required, trim + strip trailing slashes); `authHeaders` → `{ Authorization: \`Bearer ${creds.token}\` }`; each method is a one-liner over `this.request<T>(path, { method, body })`.

- [ ] **Step 4: Run → PASS. Commit** — `"feat(minecraft): mc-manager IntegrationClient"`

### Task 11: API routes

**Files:**
- Create: `src/app/api/minecraft/status/route.ts`
- Create: `src/app/api/minecraft/packs/search/route.ts`
- Create: `src/app/api/minecraft/instances/route.ts`
- Create: `src/app/api/minecraft/instances/[slug]/route.ts` (DELETE)
- Create: `src/app/api/minecraft/instances/[slug]/activate/route.ts`
- Create: `src/app/api/minecraft/rcon/route.ts`
- Create: `src/app/api/minecraft/backups/route.ts` (GET list, POST `{action:"run"}` or `{action:"restore", instance, file}`)

**Interfaces:**
- Consumes: `mcManager`, `searchPacks`, `rconCommand`, `parsePlayerList`, `loadConfig`.
- Produces JSON contracts (consumed by Task 12 hooks/UI):
  - `GET /api/minecraft/status` →
    ```ts
    {
      manager: "ok" | "unconfigured" | "unreachable" | "unauthorized";
      managerDetail?: string;
      instances: McInstance[];
      active: string | null;
      players: { online: number; max: number; players: string[] } | null;  // null when rcon down/unconfigured
      rcon: "ok" | "unavailable" | "unconfigured";
    }
    ```
  - `GET /api/minecraft/packs/search?q=...&source=all|curseforge|modrinth` → `searchPacks` result verbatim.
  - `POST /api/minecraft/instances` body `{pack: PackResult, slug?: string, memoryGb?: number}` — server derives `slug` (default `pack.slug` sanitized to the manager's slug rules), injects `cfApiKey` from config when `pack.source === "curseforge"` (400 `"Add the CurseForge API key in Settings first"` when missing), forwards to `mcManager.createInstance`.
  - `POST /api/minecraft/instances/[slug]/activate`, `DELETE /api/minecraft/instances/[slug]`, backups routes: thin probe-to-HTTP mappers.
  - `POST /api/minecraft/rcon` body `{command: string}` → `{response: string}`; 400 empty command; 409 `"RCON not configured"`; 502 with the rcon error message on failure.

- [ ] **Step 1: Implement all routes.** Conventions per Global Constraints (`force-dynamic`, awaited `ctx.params`). Probe mapping helper (put in `src/lib/minecraft/manager.ts` and reuse): `unconfigured` → 200 with the status body (status route) or 409 (mutation routes); `unreachable` → 502; `unauthorized` → 502 with detail; manager 4xx bubbled as its own status/detail. Status route runs `mcManager.instances()` and — only when `loadConfig().minecraft?.rconPassword` and `rconHost` exist — `rconCommand({...(config), command: "list", timeoutMs: 3000})` in parallel via `Promise.allSettled`; `players` = `parsePlayerList(response)`, `rcon: "unavailable"` when the command rejects (a booting modpack refuses RCON — that's a normal state, not an error).

- [ ] **Step 2: Verify.** `npx tsc --noEmit && npm run build` → clean.

- [ ] **Step 3: Commit** — `"feat(minecraft): api routes for status, search, instances, rcon, backups"`

### Task 12: Client hooks + nav entry

**Files:**
- Modify: `src/lib/client.ts`
- Modify: `src/components/side-nav.tsx`

**Interfaces:**
- Produces (consumed by Task 13):

```ts
export interface MinecraftStatusResponse { /* the Task 11 status shape */ }
export function useMinecraftStatus(refreshMs = 10000): SWRResponse<MinecraftStatusResponse>;
export function useMinecraftBackups(refreshMs = 30000): SWRResponse<{ backups: McBackup[] }>;
export function useMinecraftPackSearch(q: string, source: "all" | "curseforge" | "modrinth"): SWRResponse<PackSearchResponse>; // key null when q is empty; no refreshInterval
```

- [ ] **Step 1: Add the three hooks** to `src/lib/client.ts` following the `useContainers` pattern (`fetcher`, `keepPreviousData: true`; the search hook uses `` q ? `/api/minecraft/packs/search?q=${encodeURIComponent(q)}&source=${source}` : null `` as its key and no `refreshInterval`). Type imports for `McInstance`/`McBackup`/`PackResult` come from the lib modules (type-only imports keep server code out of the client bundle).

- [ ] **Step 2: Nav entry.** In `side-nav.tsx` add to the Integrations group before Settings: `{ href: "/minecraft", label: "Minecraft", icon: Pickaxe }` (import `Pickaxe` from `lucide-react`; if this lucide version lacks it, use `Blocks`).

- [ ] **Step 3: Verify + commit.** `npx tsc --noEmit && npm run build`. Commit `"feat(minecraft): swr hooks and nav entry"`.

### Task 13: `/minecraft` page and components

**Files:**
- Create: `src/app/(dash)/minecraft/page.tsx`
- Create: `src/components/minecraft/status-card.tsx`
- Create: `src/components/minecraft/pack-browser.tsx`
- Create: `src/components/minecraft/console.tsx`
- Create: `src/components/minecraft/backups-panel.tsx`

**Interfaces:**
- Consumes: `useMinecraftStatus`, `useMinecraftBackups`, `useMinecraftPackSearch`, `useContainers`, `postJson`, `LifecycleActions`/`ContainerStatus`/`useLifecycle`/`actionsFor` from `src/components/resources/container-controls.tsx`, UI kit components.

- [ ] **Step 1: Page skeleton with hatch states.** `"use client"` page mirroring `proxy/page.tsx`: header with status dot (`dot-running` when container running, `dot-restarting` while loading/booting, `dot-stopped` when unconfigured/stopped, `dot-dead` on unreachable); `manager === "unconfigured"` renders a `MinecraftUnconfigured` hatch panel (clone `ProxyUnconfigured` — text points to Settings → Integrations and the stack's DEPLOY.md, with a config snippet showing the `minecraft` block); `unreachable`/`unauthorized` render the error panel style with `managerDetail`. The Minecraft container row comes from `useContainers()` — find the container whose name is `minecraft`; its `id` feeds lifecycle, logs, and `ContainerStatus`.

- [ ] **Step 2: StatusCard.** Card showing: active instance (name, source badge, MC version, memory), `ContainerStatus` for the container, `LifecycleActions` (via `useLifecycle(id, mutate)`), players line (`2 / 20 — Alice, Bob`) or `booting — console unavailable` when container is running but `rcon === "unavailable"`, or `stopped`. When there is no active instance: quiet empty state "No pack active — pick one below." When the container state is `exited` with a non-zero exit code while an instance is active (the CF opt-out/manifest-error case from the spec), show an inline `text-bad` line: `Install failed — check the log below for files that need manual download.`

- [ ] **Step 3: PackBrowser.** Search `Input` (debounce 400ms via `useEffect`+`setTimeout` into a separate state the hook keys on), `Select` for source (all/curseforge/modrinth). When `curseforge === "no-key"`, show one microlabel line "CurseForge search needs an API key — add it in Settings." Result rows: icon (plain `<img>` 32px, fallback block), name, loader+mcVersion badges, downloads (compact `Intl.NumberFormat("en", {notation:"compact"})`), and an Install button with the house two-step inline confirm (button swaps to `Cancel / Confirm switch` — confirm copy: `Stops "<active name>" and switches to "<pack name>". First boot can take several minutes.`). Confirm → `postJson("/api/minecraft/instances", { pack })` then `postJson(\`/api/minecraft/instances/${slug}/activate\`)` then mutate status; on 409 from create (already installed), fall through to activate. Below results, an **Installed** list from `status.instances`: each row shows name/version/created, Activate (same confirm pattern) and Delete (two-step; disabled for the active one, title "deactivate first"). All errors inline per row (`text-bad` line), one action in flight at a time (single `pendingKey` state).

- [ ] **Step 4: Console + Backups.** Console: command `Input` + Send; scrollback `<div>` (the `logbox` class used by the container detail Logs box) appending `> cmd` and response lines from `postJson("/api/minecraft/rcon", {command})`; disabled with a hint when `rcon !== "ok"`. History kept in component state only. BackupsPanel: `useMinecraftBackups()`; rows file/instance/size (`(sizeBytes/1048576).toFixed(1)} MB`)/date; "Back up now" (disabled when container not running); Restore per row with two-step confirm (copy: `Stops nothing — restore only runs while the server is stopped. Current world is kept as data.pre-restore-*.`), disabled while the container runs (title "stop the server first").

- [ ] **Step 5: Logs.** Reuse the poll-tail pattern from the container detail page verbatim (the `Logs` function component there): copy it into the page as a local `Logs` component bound to the minecraft container id with `useSWR` on `/api/docker/containers/${id}/logs?tail=${tail}` — no new backend.

- [ ] **Step 6: Verify + commit.** `npx tsc --noEmit && npm run build`. Commit `"feat(minecraft): dashboard page - status, pack browser, console, backups, logs"`.

### Task 14: Test-stack verification, production deploy, docs

**Files:**
- Modify: `F:\Projects\CLAUDE.md` (add minecraft-stack row to Personal projects table)
- Modify: `.claude/state/task-board.md` (owner-blocked items)

- [ ] **Step 1: Test stack.** Per repo CLAUDE.md: tar working tree (excluding `.git node_modules .next data .env*`) → `/mnt/docker/stacks/homelab-dashboard-test`, `docker compose -f docker-compose.test.yml build && up -d` (port 3006). Check `$?` explicitly — never `| tail`.

- [ ] **Step 2: Browser-verify on 3006:** Settings → Integrations shows the Minecraft panel; save real manager URL/token + RCON creds (values from `.claude/local-env.md` / server `secrets.env`); `/minecraft` shows the Task 6 smoke instance as active with live player count; search "cobblemon" returns Modrinth results (CF results if key landed); console `list` answers; log tail shows server output; "Back up now" creates a file that then appears in the list; lifecycle stop → status flips to stopped → start. Fix anything found, re-verify, then `docker compose -f docker-compose.test.yml down`.

- [ ] **Step 3: Production deploy** per DEPLOY.md (archive HEAD → build → up on 3005). Verify `/minecraft` loads and shows live status in prod.

- [ ] **Step 4: Docs + merge.** Add to `F:\Projects\CLAUDE.md` Personal table: `| Minecraft Stack | personal/minecraft-stack/ | Docker/FastAPI | 8090 |`. Update `.claude/state/task-board.md`: owner-blocked = CurseForge API key (Settings), playit SECRET_KEY + tunnel claim. Merge `feature/minecraft` → main per the finishing-a-development-branch skill.

- [ ] **Step 5: Final commit** — `"docs: minecraft feature shipped; record owner-blocked setup steps"`
