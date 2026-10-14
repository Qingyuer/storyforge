# NW-0B · 原创评测基线与反例

2026-10-13；生产实现基线 `646beba1`，设计依赖 `4861441b`。本目录是测试材料与测量回执，合同权威仍为 [WORLD-ENGINE.md](../../../docs/products/WORLD-ENGINE.md) §18～19、§22。

本次完成评测基础设施，不修复生产功能。没有模型调用、浏览器产品 E2E、真人验收或规模性能验收。

## 阅读与复现

- [manifest-v1.json](./manifest-v1.json)：版本、原文 hash、划分、评分口径、参考设备和对照状态。
- [corpus-v1.json](./corpus-v1.json)：12 个原创场景族、120 条问题/答案原子、48 组修改/影响标签；每条依据带 UTF-8 字节跨度及 hash。
- [baseline-20261013-v1.json](./baseline-20261013-v1.json)：逐项 expected/observed、失败 ID、输入文件 hash 和运行环境。
- [findings-v1.json](./findings-v1.json)：10 项发现、边界、证据 ID、优先级及后续工作包。
- [实际执行器](../../helpers/narrative-world-evaluation.ts)与[回归入口](../../regression/R-NW-0B-evidence.test.ts)：使用真实封存/provider/SourcePlan/编译/修改影响接口，在逐例重建的 fake-indexeddb 中运行。

```bash
# 校验考卷与静态边界
npm run check:narrative-world
npm run check:architecture

# 比较当前实现与已提交回执；行为变化或输入 hash 变化都需要审查
npx vitest run tests/regression/R-NW-0B-evidence.test.ts

# 重新测量，默认写入被 Git 忽略的 test-results/narrative-world/baseline.json
npm run test:narrative-world:baseline

# 实现升级后用新文件保留新回执，审查后才更新 manifest.baseline.path
npm run test:narrative-world:baseline -- --output test-results/narrative-world/candidate.json
```

固定考卷不进入生产代码或模型上下文。改语料必须开新数据版本，旧成绩不覆盖；改实现则保留带日期的新回执及差异说明。普通测试不会自动改写回执。运行失败时不能把此前留下的旧回执视为本次成功。

## 实测结果

| 测量 | 实际结果 | 能说明什么 |
|---|---|---|
| 当前 provider 的 120 条查询 | 24 pass、60 gap、36 unsupported | pass 是资源集合/原文证据符合要求，不是自然语言答题准确率 |
| 开发集 / 留出集 | 16/40/24（80 条） / 8/20/12（40 条） | 数字依次为 pass/gap/unsupported；四个完整场景族留出，占 33.3% |
| 24 条 literal 全文对照 | 24 pass | 仅标题/正文短语检索；不能与 120 条混算，也不能证明语义理解 |
| 168 条边界与能力控制 | 96 pass、72 gap | 包含候选、历史、视角、证据、预算和 owner 控制 |
| 六产品 adapter 的 24 条控制 | 12 pass、12 gap | 明确两个 key 的通用计划和生产编译各 6 pass；仅数量及禁止策略各 6 gap |
| 48 组修改影响 | TP=55、FP=77、FN=0；precision=41.67%、recall=100% | 分母为后续章节的复核建议；所有集合都含额外章节，48 组均未达到精确集合目标 |
| 锁定事实 / 冻结版本 / 另一 Work | 各 48/48 保持 | 另一 Work 与被测作品共享同一 World，仍未被纳入影响或改动 |

25 项 Vitest 测试通过代表考卷、边界和上述行为可复现。已知缺口保留为 `gap`，尚不存在的方法保留为 `unsupported`；不将它们折算为通过。

修改影响逐类分母如下；每类 12 组，同一章节在不同修改组中分别计分：

| 修改类别 | TP / FP / FN | precision | recall |
|---|---|---|---|
| 事实改变 | 24 / 12 / 0 | 66.67% | 100% |
| 仅外观措辞 | 0 / 36 / 0 | 0% | 无正例分母，不记作 100% |
| 锁定规则的草稿改写 | 19 / 17 / 0 | 52.78% | 100% |
| 获知时间/认知改变 | 12 / 12 / 0 | 50% | 100% |

## 处理优先级

| 优先级 | ID | 可复现发现 | 后续落点 |
|---|---|---|---|
| P1 | NW-G02 | `characterId=A/null` 未限制知识目录；A scope 可按 B 的 key 读取原文，36 个反例 | 1B / 2B / 2C；先明确知识与可见性，再贯通各读取通道 |
| P1 | NW-G01 | 实体、故事线、章节截止条件仅影响 cursor hash，不筛选返回集合，36 个反例 | 1A / 2B；身份/时间合同与真正执行过滤 |
| P1 | NW-G04 | 12 个历史有效状态在 `superseded` 后被 v3 confirmed-only 封存策略排除 | 1A / 1B / 2A；保留合法历史，不放开未确认候选 |
| P1 | NW-G05 | planned 意图与 confirmed 错误信念的 descriptor 均为 `author-canon`，24 个反例 | 1B / 2B；区分 modality、审校状态、authority 与视图 |
| P2 | NW-G10 | `maxTokens=1` 的 index 读取返回 33 tokens，截断提示自身超预算，12 个反例 | 2B；预算不足显式降级/拒绝 |
| P2 | NW-G07 | 修改影响按所有后续章节扩散；独立支线和仅外观修改产生多余复核 | 1B / 2D；证据依赖、精确性和作者负担对照 |
| P2 | NW-G03 | 12 条仅在正文出现的短语无法通过 metadata 搜索找到 | 2A / 2B；原文 lexical 索引及支持矩阵 |
| P2 | NW-G06 | 只报“选中 2 个”却不带 keys 时只强制 1 个；六产品禁止策略为空 | 2C；精确选择、依赖闭包及产品专属规则 |
| P2 | NW-G08 | 24 条 typed 因果/发展查询没有对应 `query` 方法 | 1B / 2B；先实现可证据验证的子集 |
| P3 | NW-G09 | 12 条假设没有对应 `simulate` 方法 | Phase 2 之后另立任务 |

P1 表示增强能力接入前应优先处理的共享读取/语义问题，不表示已发现线上安全事件。本轮没有证据支持数据丢失或对外泄漏的 P0 判断。

0B 交付时的下一工作包为 **NW-1A：IR 身份、时间和 codec**（实施结果见下方后续对照），然后进入 1B/1C 和各 2x 卡。上述排序用于安排反例和退出门，不授权跳过合同直接重写生产模块。小型现有接口修复可以另拆维护任务，但要保留同一考卷与版本兼容性。

## 已有保护与结论边界

- 候选、stale、rejected、source-missing、invalid-range 没有混入 release；禁止封存候选工件、产品运行表、媒资表及检索缓存的入口检查通过。
- 原文证据的 hash 篡改、错误 project scope、变更过滤条件后复用旧 cursor 均被拒绝；过大 original 被明确拒绝，没有截断后冒充原文。
- 显式两 key 的 SourcePlan 和生产编译都完整保留所选资源。因此 NW-G06 不能表述成“生产路径普遍漏读”。本次所选都是角色，不能代替全部跨表依赖闭包验收。
- `author-canon` 也可表示“作者确认了这条错误信念记录”；其原始 belief/action/status 被保留。NW-G05 是新语义投影目标的差距，不能据此断言所有产品已误把信念当真。
- NW-G05 的 `intent` / `character-belief` 是语义对照标签，不是要求向现有 `ContextResourceAuthorityV1` 塞入这两个枚举值。本项记录 v3 单一标签的表达边界；1B/2B 必须按 §12 的 modality × reviewState × authority 接入新的 IR 评测器，不能用改写 authority 字符串代替实现或把此探针当作未来 IR 的验收器。
- `searchMetadata` 没有承诺正文全文搜索。非空目录的 `queryableIndexAvailable=true` 控制通过；正文索引与 typed query 的缺失单列，不能把旧字段解读成已支持所有查询。
- 修改影响的 FP 是多余复核建议。48 组没有误改锁定事实、另一作品或冻结 release；原文证据消失时已有 stale 行为也保留。没有执行自动重写，更没有度量自动删稿损失。
- 角色范围只测 provider 元数据和另一角色的 original；尚未覆盖所有缓存、聚合计数、边、explain 或具体产品完整运行链。结果不是完整安全验收。

## 数据与评分限制

开发场景：南汀渡口、倒悬钟楼、封蜡信、雾港账簿、药圃停钟、空弦剧场、未赴的婚约、裂瓷工坊。留出场景：岔路水闸、日影驿站、芦苇巡航、两册仓单。

各故事的事件和依赖不同，操作类别重复以便比较。留出按整个故事划分，不把同一故事改名后跨集合分配；但数据作者已经看过留出，不能称盲测。全部内容是本任务原创合成文本，按仓库 MIT 许可，不含作者手稿或第三方小说。

gold 由文本与明确的封闭世界依赖标注构成，经过本次 Agent 自查和字节证据校验，**没有独立人工复核**。冻结前更正了剧场场景的信念时间点、七组规则修改的第二段依赖，并补全因果问题的规则证据；详情在 manifest.annotationReview。fixture 另有明确人工设定的旧/新地点历史和锁定知识断言，用于状态生命周期控制，不声称从小说自动抽取了这些断言。

现阶段只评分资源集合、原文跨度与修改复核集合。自然语言 `answerAtoms` 已冻结，因缺真实 reader/评阅者而尚未评分。没有模型自答、自评或 fixture 冒充真实模型；provider/model、文学质量、作者接受度和费用均未测。

10万/30万/100万字符扩展、IR+lexical、vector/planner 与消融均未运行。本轮记录原文短样本，不把“低频事实”场景叫作百万字长尾成绩。已冻结参考配置：Apple M1 Pro、32 GiB、macOS 26.6.2、Chrome for Testing 151.0.7922.34；浏览器仅读取安装版本，实际评测在 Node v24.16.0 / happy-dom / fake-indexeddb 中完成。NW-2E 按既定冷/热运行次数和去重规模指标另行验收。

工程验证回执见 [WORLD-ENGINE.md §22](../../../docs/products/WORLD-ENGINE.md#22-nw-0b-评测基线与处理优先级2026-10-13)；本目录不提升任何产品、真实模型或真人质量状态。

## NW-1A 后续对照：身份、时间与编码

NW-1A 的实际实现与限制见 [WORLD-ENGINE.md §23](../../../docs/products/WORLD-ENGINE.md#23-nw-1a-身份时间和编码合同2026-10-13)。本轮增加后台合同，不改 provider、修改影响算法或 v3 发布策略。

- [合同回执](./ir-contract-20261013-v1.json)：同一 12 场景/120 查询/48 修改的 249 个证据跨度（含重复引用）通过新 codec；同名身份、改名/重排、旧章序与 release hash 保持均 12/12。独立编解码/时间/生命周期反例见 `R-NW-1A-ir-codec.test.ts`。
- [编码 golden](./ir-codec-golden-v1.json)：八类 variant 的 record/root hash 及 Unicode 码点排序黄金向量。原文不做 NFC/换行转换，有序集合不排序。
- [NW-1A 后重跑 v3](./baseline-20261013-nw1a-v1.json)：所有原 expected/observed 与 [旧基线](./baseline-20261013-v1.json) 相同；查询仍为 24/60/36，修改影响 precision 41.67%。没有把合同通过折算成查询质量提升。

已解决的合同层风险：名称/排序参与身份、未知时间被误当精确时间、多个时间轴混用、裸跨 namespace 引用、额外 JSON 字段/不安全数字、UTF-8 截断、循环依赖哈希、旧 hash 被静默重绑。旧数据缺 UID 保留 partial；现有显式创建仍负责分配，读操作不补写。正常备份恢复保持 owner code，世界包 remix 则生成新 namespace；两者均有隔离回归。

本轮没有新增领域持久化字段、迁移、UI 或 AI 入口；hard-rule 执行器、条件时间映射/隐式反向转换、外部世界引用装配、语义 projector/查询过滤仍不支持。G01/G04/G05 的表示前置已具备，但原 10 类缺口全部保留。下一卡为 NW-1B。

```bash
# 普通复现：必须与已审查的合同回执及 v3 基线一致
npx vitest run tests/regression/R-NW-1A-ir-codec.test.ts tests/regression/R-NW-0B-evidence.test.ts

# 明确生成候选合同回执，再审查输入 hash/逐场景结果；不可覆盖旧版本
NW_IR_REPORT=/tmp/nw1a-candidate.json npx vitest run tests/regression/R-NW-1A-ir-codec.test.ts
```

以上是确定性合同与隔离数据库证据；未做文学质量、真实模型、独立人工或规模性能验收。

### 2026-10-14 主干整合对照

在 NW-1A `bfc68581` 上整合 `origin/main` 的 `e40fadce`（应用 v4.0.0）。[整合回执](./baseline-20261014-integration-v1.json) 保留新的输入指纹；原两份基线和 IR golden 不变。120 查询、48 修改及全部边界控制的逐项结果与 NW-1A 相同，仍为 24 通过 / 60 缺口 / 36 不支持，影响分析 precision 41.67%。主干便携交付和文字冒险更新没有被计作 NW 能力提升。

整合检查：97 项 NW 定向测试、architecture/required-tables/AI manual、其余静态门、lint、TypeScript、生产依赖审计和 build 通过。整合阶段的全量 CI 在 coverage 执行中为共享机器串行协调主动停止（exit 143，日志 `/tmp/nw-integration-20261014-ci.log`），未取得全量完成回执；后续 NW-1B 交付仍须通过串行完整 CI。
