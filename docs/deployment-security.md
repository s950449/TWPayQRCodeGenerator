# 自動部署、資料更新與 GitHub Actions 安全設定

## 流程與權限

| 流程 / job | 觸發 / 信任來源 | `GITHUB_TOKEN` 權限 |
| --- | --- | --- |
| `test / verify` | push、PR、手動、同 repository 的 reusable workflow | `contents: read` |
| `deploy-pages / package` | `main`，同一次 run 的驗證通過後；只打包 `docs/` 中網站實際使用的 `index.html`、`css/`、`js/`、`vendor/`、`data/`，本文件與規劃文件不發布 | `contents: read` |
| `deploy-pages / deploy` | 只部署同一次 run 的 Pages artifact；不 checkout 或執行專案程式 | `pages: write`、`id-token: write` |
| `update-bic / prepare` | 每週一約臺灣時間 09:23、或在 `main` 手動執行 | `contents: read` |
| `update-bic / propose` | 只接受同一次 run 的 candidate；使用該 run 的 `main` 程式 | `contents: write`、`pull-requests: write` |

workflow 頂層一律 `permissions: {}`，依 job 開放權限。checkout 一律
`persist-credentials: false`。不使用 `pull_request_target`、`workflow_run`、
跨 run artifact、共享依賴 cache、長效 PAT 或 GitHub App 私鑰。

下載外部資料的 job 沒有寫入 token，也不安裝第三方 Python 套件。
寫入 job 不執行 artifact 中的程式碼、不 checkout bot / PR 分支、不使用 git hooks。
它限制檔案集合、大小與 symlink，重新解析 CSV、重新產生 JS / manifest 並逐位元組比對。
GitHub API 寫入只組合以下三個固定路徑，commit tree 以該 run 的 `main` 為底：

- `data/BIC.csv`
- `docs/js/bic-data.js`
- `docs/data/bic-manifest.json`

沒有內容變更不建立 PR；`main` 已前進會失敗，請重新執行。既有 bot 分支若包含
allowlist 以外的修改會拒絕更新；只以 fast-forward 更新，不 force-push。
正常更新會保留 bot 分支歷史，並帶入最新 `main`。請勿手動修改 bot 分支。

> GitHub 的 `contents: write` 不是路徑限定權限，token 技術上仍可寫入其他分支。
> 三個路徑的限制是受審核的程式邏輯，不是 GitHub 的權限邊界。
> 必須搭配下列 ruleset，避免有權限的 workflow / 相依套件被入侵後直接修改 `main`。

## 必須由 repository 管理者在 GitHub 後台完成

本次程式修改**不會**自動修改 repository、organization 或 environment 設定。

2026-11-17 唯讀檢查的遠端現況：

- 預設 workflow permissions 為 `write`，應改為唯讀。
- `allowed_actions: all`，應縮限；Require lockfile 仍須在後台確認並啟用。
- `main` 的 `protected` 為 `false`，且沒有 ruleset。
- Pages 為舊的 branch 部署（`main` 的 `/docs`），尚未切換到 Actions。
- `github-pages` environment 已只允許 `main`，沒有 required reviewer。
- Actions 建立 / approve PR 的開關已啟用。

**這些未完成前，不應宣稱整個 repository 的部署與合併已有強制安全閘門。**

1. **Settings → Pages**
   - Source 設為 **GitHub Actions**。
2. **Settings → Actions → General**
   - 預設 Workflow permissions 設為 **Read repository contents and packages**。
   - 啟用 **Allow GitHub Actions to create and approve pull requests**，供資料更新開 PR；
     程式不會呼叫 approve 或 merge。這個開關本身也允許 approve，所以 ruleset 必須
     要求真人 Code Owner 審核。
   - Fork PR 不傳入 secrets / write tokens；不要啟用這類例外。
   - 外部貢獻者執行 workflow 選擇 **Require approval for all outside collaborators**。
     核准前先看 workflow、scripts、lockfile 的修改；不要為陌生 PR 隨意按核准。
   - Allowed actions 限制為使用中的官方 `actions/*`，不要允許任意第三方 action。
   - 啟用 **Require lockfile**。若帳號 / 組織另有 SHA pinning policy，
     onboard 到 lockfile 的 workflows 可由 lockfile 滿足此要求。
3. **Settings → Rules → Rulesets：保護 `main`**
   - Active，require pull request、至少一位真人 approval、Code Owner approval。
   - Dismiss stale approvals；要求最近一次可審核 push 的 approval。
   - Require status check：選取本 repository 的 **`verify`（GitHub Actions）**；
     請等第一次 run 後從實際 check 名稱選取，並要求 branch up to date。
   - 禁止 force-push / deletion；不給 GitHub Actions / bot bypass。
   - 可行時管理者也不 bypass；檢查組織層是否另有例外。
4. **Settings → Environments → `github-pages`**
   - Deployment branches 限制 **Selected branches: `main`**，不要允許任意 branch / tag。
   - 可加 required reviewer 作為第二道部署核准（會讓部署等待人工批准）。
   - 不需要任何付款資料、帳號或長效部署 secrets。

`.github/CODEOWNERS` 以 `* @s950449` 指定所有路徑（含定義 CI 指令的 `package.json`）的預設審查者，
並明列 workflow、scripts、依賴、網頁與資料。
**只有啟用 Code Owner approval 才會強制執行**。Code Owner 不能批准自己的 PR；
如果只有一位維護者，應新增另一位可信任 reviewer 並一併加入 CODEOWNERS，
而不是默默關掉審核。

只靠 YAML 無法防止 PR 同時修改 YAML、lockfile 與測試來繞過檢查。
Require lockfile 防止漏鎖，不代表鎖定的 commit 是安全的。Code Owner / branch
保護才是合併前的信任邊界；請不要自動合併依賴或資料 PR。

## 財金資料與 manifest

`data/BIC.csv` 是唯一資料來源。瀏覽器仍完全使用 repository 內的靜態資料，
不在使用者開啟頁面時連到財金公司。資料 manifest 記錄來源、正規化 CSV 的
SHA-256、筆數與更新時間。時間表示產物更新時間，不是財金公司的發布時間。
內容未改變會保留時間戳，不產生每週無意義的 PR。

```bash
# 下載並驗證，在本機同步三個檔案（不建立 GitHub PR）
python3 scripts/bic_assets.py --refresh

# 已手動更新 CSV 後產生網頁資料與 manifest
python3 scripts/bic_assets.py

# CI / 本機一致性檢查
python3 scripts/bic_assets.py --check
```

至少要有 50 筆資料；每次最多移除舊資料的 10%（至少允許 2 筆）。
代碼限三位 ASCII 數字，禁止重複，名稱限制長度與控制字元；HTTP 限時、限大小、
禁止轉址，HTTPS 憑證照常驗證。門檻異常時人工查證後開一般 PR，**不要為通過排程
而關掉驗證**。來源回傳 403、改格式或暫時不可用時 workflow 失敗，既有資料保留。
僅接受兩種已確認的完整表頭：`業務別,銀行代號/BIC,金融機構名稱` 及舊版
`業務別,銀行代號/BIC/總機構代碼,金融機構名稱`；其他格式一律拒絕。

### Bot PR 的 CI

使用 `GITHUB_TOKEN` 建立 / 更新的 PR 通常**不會**觸發 PR / push workflows。
本設計不為解決這點另存高權限 PAT，也不開 `actions: write`。
`prepare` 與 `propose` 都驗證資料，但不代替完整 CI。

維護者先確認 PR 只改三個預期檔案，再手動啟動 read-only 測試：

```bash
gh workflow run test.yml --ref automation/update-bic
gh run list --workflow test.yml --branch automation/update-bic
```

等該 branch **最新 commit** 的 `verify` 成功後，由 Code Owner 核准並合併。
bot 每次更新後都需要重新執行與審核；不要 bypass required checks。
合併至 `main` 會再次完整驗證，成功後才封裝 / 部署。建議啟用合併後自動刪除分支。

## 三種 lock / manifest 不同

### GitHub Actions：`.github/workflows/actions.lock`

由官方 `github/gh-actions-lock` 產生，包含直接與 composite action 的間接依賴、
精確 commit、repository / owner ID。不要手改。使用明確版本 tag，
Dependabot 每週開更新 PR，GitHub 會連同對應 lock entry 更新，仍須人工審查。

```bash
gh extension install github/gh-actions-lock --pin v0.4.1
gh actions-lock
gh actions-lock --verify
git diff -- .github/workflows
```

僅在刻意升級、確認 upstream 變更後使用 `gh actions-lock --relock`；
不要在 CI 使用 `--accept-moved` 或自動重鎖。CI 的驗證器固定 v0.4.1 Linux
amd64 binary 並核對 SHA-256，下載後不是立即盲目執行。

lockfile 不鎖定外部 reusable workflow、Docker image、runner OS、
setup-python / setup-node 下載的 runtime、`run:` 指令下載物或 pip 套件。
本專案僅呼叫同 repository / 同 commit 的 reusable workflow，不呼叫外部 reusable
workflow，不使用容器；使用短期 GitHub-hosted `ubuntu-24.04` runner，
不在 PR 上使用 self-hosted runner。Python / Node patch 與 runner image 仍屬剩餘供應鏈風險。

### Python：`requirements-ci.lock`

含 runtime 與 `pip-audit` 的完整相依版本及 hashes。CI 只安裝符合 hash 的 wheels，
禁止 source build；也檢查輸入的直接版本與 lock 一致。更改版本後在可信任環境重產：

```bash
uv pip compile --generate-hashes --python-version 3.11 --no-build \
  requirements-ci.in -o requirements-ci.lock
python3 scripts/check_python_lock.py
```

不要在 CI 動態升級 pip / audit 工具。Hash 是完整性檢查，不是安全保證；
初次鎖定與每次依賴更新仍需審閱來源及漏洞報告。`pip-audit` 查的是已知漏洞，
也不能證明套件沒有惡意行為。

### 瀏覽器 vendor：`docs/vendor/manifest.json`

與財金資料無關。升級 vendor 時，確認可信任上游 release，更新本機檔案、引用、
版本、授權與 hash，再執行 `npm run verify:vendor` 及 JS 測試。
不要因 hash 不合就直接把 manifest 改成未知檔案的 hash。

## 第一次啟用

1. 審閱這次程式、產物與 lockfile，先設定可用的後台保護；合併後將 Pages source
   從 branch 部署切換成 Actions。舊的 branch 部署不受新 workflow 驗證 job 控制。
2. 在 `main` 手動執行 `test`，確認 check 可被 ruleset 選取。
3. 手動執行 `deploy-pages`，確認環境限制與 Pages 網址。
4. 在 `main` 手動執行 `update-bic`，確認來源可從 GitHub runner 下載、bot 可開 PR，
   並按上述步驟在 bot branch 執行測試。不會自動 approve / merge。

實際權限與 Pages 部署仍須在 GitHub 執行驗證，本機測試不能證明後台設定已生效。

參考：[GitHub workflow dependency lockfiles](https://docs.github.com/actions/concepts/security/workflow-dependency-lockfiles)。
