# 角色蒸馏 Skill 生态调研与通用蒸馏管线设计草案

## 摘要

本报告基于对 `external-projects/` 目录下 59 个第三方"角色蒸馏 Skill"以及 GitHub 上 `awesome-persona-skills` 列表的系统性阅读，归纳了这一新兴生态的统一架构与典型变种，并据此提出一套可在 ClawPet 体系中实现的通用人物蒸馏管线设计草案。

核心结论：

- **存在事实标准**：尽管作者各异、目标人物迥异，绝大多数 Skill 都遵循同一条"七阶段蒸馏管线"和同一份"八件套人物档案"骨架，差异主要体现在数据源、人物家族、输出形态、演化机制四个轴向。
- **元 Skill 与角色 Skill 已分化**：以 `nuwa-skill` / `bggg-skill-taotie` / `darwin-skill` / `curator-skill` 为代表的"元 Skill"已经把蒸馏、进化、优化、路由等流程本身作为一等公民产品，标志着该生态从"手工产物"走向"可复现的工程"。
- **真正的难点在数据与边界**：高质量第一手材料的采集、不可信源的过滤、伦理与隐私的把关，是任何通用管线都必须正面回应的工程化问题。
- **ClawPet 的天然契合点**：ClawPet 已具备 Skill/Plugin 体系、多 LLM 路由、CCP（ClawPet Connect Protocol）通道、定时任务系统与 MCP 客户端，全部可作为通用蒸馏管线的底层骨架，本提案的工程量主要落在"采集器矩阵 + 提取器矩阵 + 装配器 + 演化通道"四类新模块。

报告末尾列出尚需用户确认的产品定位、数据立场、伦理承诺、技术边界等关键决策点，以便进入下一阶段的方案落地。

---

## 一、调研对象与方法

### 1.1 调研对象

调研覆盖两类材料：

- `https://github.com/tmstack/awesome-persona-skills`：社区维护的角色 Skill 清单，作为生态边界参考。
- 本仓库 `external-projects/` 目录下 59 个独立 Skill 工程，作为深入阅读样本。每个工程通常以 `SKILL.md` 为入口，部分附带 `README.md`、`templates/`、`agents/`、`docs/` 等子目录。

### 1.2 调研方法

为了在有限上下文中获得有代表性的结论，采用"先元后例、先共性后变种"的策略：

1. **元 Skill 优先**：先阅读显式定义蒸馏流程的元 Skill（`nuwa-skill`、`bggg-skill-taotie`、`darwin-skill`、`curator-skill`），用它们的设计文档作为生态骨架。
2. **按家族抽样**：再按"自我 / 亲密关系 / 同事职场 / 公众人物 / 虚构角色 / 文化哲学 / 万物"六个家族抽样阅读各家族中至少一个代表 Skill，验证骨架是否成立、是否存在变种。
3. **变种归纳**：将偏离骨架的设计统一收集，作为"变种与创新点"独立成节，不污染共性归纳。
4. **设计反推**：以骨架 + 变种为约束条件，反推一套"四轴可插拔"的通用管线设计草案。

### 1.3 一致术语表

为避免后文歧义，统一以下术语：

- **角色（Persona）**：被蒸馏的对象，可以是真人、虚构人物、抽象群像，亦可扩展到宠物、关系、地点、瞬间。
- **角色 Skill**：蒸馏的产物，以一份可加载到 LLM 宿主中的 `SKILL.md` 为核心。
- **蒸馏管线**：从原始材料到角色 Skill 的端到端流程。
- **元 Skill**：用来生产、评估、进化或路由其他角色 Skill 的 Skill。
- **宿主**：执行角色 Skill 的运行时环境，常见有 Claude Code、OpenClaw、Hermes、Codex、ClawPet。

---

## 二、Skill 生态全景

### 2.1 按"被蒸馏对象"划分的角色家族

| 家族 | 典型 Skill | 关注的核心问题 |
| ---- | ---------- | -------------- |
| 自我 | `yourself-skill`、`digital-life` | 自我反思、数字遗产、人生回顾 |
| 亲密关系 | `ex-skill`、`first-love-skill`、`crush-skills`、`her-skill`、`partner-skill`、`love-skill`、`reunion-skill` | 情感记忆封存、对话陪伴、情绪疗愈 |
| 家庭 | `parents-skills`、`brother-skill`、`yinyuan-skills` | 关系修复、家庭沟通、长期陪伴 |
| 同事职场 | `colleague-skill`、`hr-skill`、`boss-skills`、`supervisor`、`senpai-skill`、`professor-skill`、`x-mentor-skill` | 职场对话演练、上下级关系、求助与反馈 |
| 公众人物 | `elon-musk-skill`、`steve-jobs-skill`、`buffett-perspective`、`munger-skill`、`naval-skill`、`taleb-skill`、`feynman-skill`、`zhang-yiming-skill`、`duan-yongping-skill`、`maoxuan-skill`、`trump-skill` 等 | 思维模型迁移、决策视角扩展 |
| 虚构与文化 | `skill_everyone`、`Dobby`、`Master-skill`、`diamond-sutra-skill`、`zizek-skill` | 二次元角色、宗教与哲学家身份扮演 |
| 功能型角色 | `hr-skill`（拒信）、`tiangou-skill`、`fengge-skill`、`star-skill`、`khazix-skills`、`bazi-skill` | 把"角色"作为执行某项业务的人格化壳子 |
| 万物 | `relic.skill` | 把蒸馏对象扩展到宠物、地点、关系、瞬间等非人实体 |
| 元工具 | `nuwa-skill`、`bggg-skill-taotie`、`darwin-skill`、`curator-skill`、`anti-distill`、`blogger-distiller`、`chat_with_me`、`immortal-skill` | 蒸馏、进化、优化、路由、反向蒸馏、报告生成 |

### 2.2 按"在生态中的角色"划分的 Skill 类型

- **角色 Skill（终端产物）**：被加载即可"成为某人"或"代入某人视角"，占样本的多数。
- **元 Skill（生产工具）**：自身不扮演具体人物，而是用于生产、评估、进化、检索或编排其他角色 Skill。
- **功能性人格化 Skill**：以人格作为壳层，本质是完成某类业务任务（如生成拒信、写舔狗文学、作为占星师/算命师产出结构化结果）。

理解这一分层非常重要：通用管线既要服务"终端产物"的可加载性，也要为"元 Skill"留出 Hook，让生态自身可以演化。

---

## 三、统一架构特征（共性）

### 3.1 七阶段蒸馏管线

跨越所有元 Skill 与多数角色 Skill，可以归纳出同一条端到端流水线：

```
Phase 0 意图诊断 → Phase 1 多源材料采集 → Phase 1.5 采集质量校验
       ↓
Phase 2 多维度提取 → Phase 2.5 提取质量校验
       ↓
Phase 3 模板装配（含 Agentic Protocol 注入）
       ↓
Phase 4 质量验证（已知答案 / 边界 / 风格盲测）
       ↓
Phase 5 发布、订阅与演化通道
```

阶段含义：

- **Phase 0 意图诊断**：判断用户是想"为某个真实人物建模"、"扮演某种角色"、还是"获取某种视角"，并据此选择下游配方。`curator-skill` 是该阶段最完整的实现，能把模糊请求路由到 `nuwa-skill` / `colleague-skill` / `yourself-skill` 等专用工具。
- **Phase 1 多源材料采集**：用户上传 + 网络爬取 + 平台 API + 浏览器操作 + 直接对话五种通道并行；多数 Skill 在这里做了"6 路并行 Agent"或"按平台拆分采集器"的设计。
- **Phase 1.5 采集质量校验**：以人在回路的方式让用户确认"我们采到的材料够不够、靠不靠谱"，避免后续提取建立在垃圾数据上。
- **Phase 2 多维度提取**：把原料拆解到"心智模型 / 表达 DNA / 价值观 / 记忆 / 决策启发式 / 关系网"等结构化字段。
- **Phase 2.5 提取质量校验**：再一次人在回路，让用户对提取出的关键字段（特别是心智模型与价值观）做去重、合并、纠偏。
- **Phase 3 模板装配**：用统一模板生成 `SKILL.md`，并在合适位置注入"Agentic Protocol"——告诉运行时遇到事实问题时应主动调用工具检索，而非凭直觉回答。
- **Phase 4 质量验证**：通过"已知答案对照、边界场景、风格盲测"三类自动化测试评估输出可用性。
- **Phase 5 发布、订阅与演化**：包括版本管理、增量补强、纠错通道、与其他 Skill 的对照进化等。

### 3.2 八件套人物档案

绝大多数角色 Skill 的 `SKILL.md` 包含同一组结构化字段，可视为该生态的"事实标准 schema"：

1. **Frontmatter 元数据**：`name` / `description` / `version` / `tags` 等。
2. **角色扮演规则**：身份锁定、第几人称、何时跳出角色、Layer 0 红线（"绝对不会说/做的事"）。
3. **身份卡片**：基本信息、生平与时间线、关键身份标签。
4. **心智模型**：核心思维框架（如 `elon-musk-skill` 的"渐近极限 / 五步算法"），通常要求通过"三重门"验证（跨场景复现、可生成新结论、与他人区分度）。
5. **决策启发式**：在典型情境下的判断顺序与权衡规则。
6. **表达 DNA**：词汇偏好、句法节奏、幽默方式、确定性强度、惯用比喻。
7. **价值观与内在张力**：信什么、不信什么、内部矛盾、痛点。
8. **诚实边界 + 智识谱系**：不知道什么、依赖谁、立场来自哪里。

部分 Skill 在此之上扩展了"关系网络"（家人/同事/朋友）、"互动模式"（典型互动场景与回应模板）和"记忆切片"（具体事件 + 情绪标签）。

### 3.3 数据源策略

生态对数据源的态度高度一致，可总结为一个优先级和一份黑名单：

**优先级（从高到低）**：

1. 用户提供的第一手材料（聊天记录、邮件、笔记、照片、录音）。
2. 角色本人作品（书、论文、博客、长视频）。
3. 高质量长访谈与对谈。
4. 公开的决策记录（公司财报会议、年报、备忘录）。
5. 角色本人社交媒体原文。
6. 第三方深度分析与可信媒体。
7. 二手解读、转引、汇总贴。

**黑名单（多家 Skill 显式列出）**：

- 知乎、微信公众号、百度百科等强观点、易污染的中文聚合源。
- 内容农场、自动洗稿站、营销号短视频脚本。
- 不可追溯到原始出处的二手长文。

`curator-skill` 把这种价值观抽象为"X-perspective hijack"规则：当用户问"X 怎么看 Y"，必须先调用 X 的角色 Skill，避免大模型自由发挥造成的失真。

### 3.4 输出模式

同一份角色档案，被设计为可以以多种方式被消费：

- **沉浸扮演 `/<slug>`**：第一人称扮演，最常见。
- **视角分析 `/<slug>-perspective`**：第三人称地"以 X 的视角分析当前问题"，避免扮演带来的人格漂移。
- **元提问 `/<slug>-ask`**：把角色当成知识库提问，"如果是 X，会怎么处理"。
- **风格改写 `/<slug>-rewrite`**：把任意输入按角色的表达 DNA 重写。
- **结构化产物**：如 `blogger-distiller` 同时输出 HTML 报告 + 可运行的"创作指南"Skill 文件夹；`hr-skill` 输出格式化的拒信、裁员通知。
- **训练数据**：少数 Skill 把对话样本作为微调语料导出。

设计上的关键经验：**模式分离比模式合并更安全**。同一个 Skill 同时承担扮演与分析两种语义时，容易在长会话中发生人格漂移。

### 3.5 质量保证机制

- **Layer 0 硬规则**：每个角色 Skill 都明确列出"绝对不会做/说的事"，作为运行期最高优先级的拒答规则。
- **三重门验证**：心智模型必须满足"跨场景复现、生成性、互斥性"三项。
- **三类自动化测试**：已知答案对照（事实是否正确）、边界场景（敏感问题是否触发拒答）、风格盲测（用户能否区分真伪）。
- **双 Agent 评审**：`bggg-skill-taotie` / `darwin-skill` 让两个 Skill 解同一题，由独立评审 Agent 判分，定位短板。
- **人在回路**：Phase 1.5 与 Phase 2.5 的强制确认点，把用户作为质量门控的一部分。

### 3.6 演化机制

成熟 Skill 通常预留三类演化通道：

- **`append` 增量补充**：发现新材料后追加到对应字段，不动旧内容。
- **`correction` 纠错**：用户说"他不是这样的人"时，定位到具体字段做修订并记录原因。
- **`snapshot` / `rollback` 版本管理**：每次有显著修改打快照，便于回退。Skill 自身常以 git 仓库形式存活，进化历史即提交历史。

`darwin-skill` 进一步把 8 维评分（结构 4 维 + 效果 4 维）作为 RL 风格的奖励信号，让 Skill 在多轮对照测试中自动迭代。

### 3.7 伦理与边界

涉及真人（尤其是亲密关系）的 Skill 高度敏感，生态形成了若干共识：

- **本地优先**：原始材料只在本地落盘，云端只跑提取与推理。
- **不替代真人接触**：前置警示用户"这是数字镜像，不是本人"，必要时主动建议联系真实当事人。
- **隐私边界**：不导出他人未授权的个人信息，不做反向画像或人脸识别匹配。
- **明确 AI 标签**：在所有输出中保留"由 AI 扮演"的标识。
- **温柔删除**：提供"放下/告别"语义化操作（如优雅删除、骨灰盒导出），而不是冷冰冰的 `rm -rf`。

---

## 四、特殊变种与创新点

共性之外，最具启发性的变种集中在以下若干 Skill：

### 4.1 `nuwa-skill` —— 把"研究行为"嵌进角色

`nuwa-skill` 在装配阶段为每个角色 Skill 注入 **Agentic Protocol**：当被问到事实性问题时，角色应主动调用搜索/读文件等工具去查证，而非凭"扮演直觉"回答。这把"角色"从静态文本档案升级为能动调研的 Agent。同时它采用 6 路并行子 Agent 完成材料采集，是该生态中最完整的"工程化蒸馏"实现。

### 4.2 `bggg-skill-taotie` —— Skill 吃 Skill 的进化

`taotie` 让两个 Skill 解同一组题，由评审 Agent 找出胜者的优势（结构、提示词、推理链），再把这些优势"吞入"被进化的 Skill。它把"蒸馏"从"对人物建模"扩展到"对 Skill 本身建模"，开启了 Skill 之间的代际进化路线。

### 4.3 `darwin-skill` —— 自我演化的 Skill 优化器

`darwin-skill` 用独立子 Agent 做效果评测，按 8 维评分（结构 4 维 + 效果 4 维）打分，并以 git 提交承载快照与回退。它本质上是为 Skill 设立了一个 RL 风格的优化循环。

### 4.4 `immortal-skill` —— 数字永生的统一框架

`immortal-skill` 引入"7 类角色模板 × 12+ 数据平台 × 4 维提取（程序化记忆 / 互动 / 长期记忆 / 人格）"的矩阵，并在每条事实上打**证据等级**（A/B/C/D）。它是把"严肃数字遗产"作为产品级目标的代表。

### 4.5 `relic.skill` —— 把蒸馏对象扩展到"万物"

`relic.skill` 把宠物、亲密关系、团队、地点、瞬间都纳入蒸馏对象，并把流程拆为 **soul-forge / soul-engine / soul-shield** 三段式（铸造 → 运行 → 守护）。它提示我们：通用管线不应预设"对象一定是人"。

### 4.6 `anti-distill` —— 反向蒸馏

`anti-distill` 反其道而行：在公司强制员工提交"知识 Skill"时，**生成一份看似完备但抽掉了核心 Know-how 的对外 Skill，并在私域保留完整版**。它揭示了一个生态层面的对抗博弈：当蒸馏成为强制义务，反蒸馏会自然出现。通用管线的权限模型必须正视这一点。

### 4.7 `blogger-distiller` —— 多形态产物

`blogger-distiller` 接入 TikHub API 抓取小红书数据，最终同时输出：
- 一份适合人类阅读的 HTML 报告。
- 一份可加载的"创作指南"Skill 文件夹。

这是"同一份蒸馏，三种消费者"的范式：人 / 模型 / 客户端。

### 4.8 `chat_with_me` / `curator-skill` —— 接入与发现

- `chat_with_me` 主打"绑定我的社交账号 → 自动产出三模式 Skill"，目前覆盖 X 与小红书。
- `curator-skill` 把"应该用哪个 Skill"作为路由决策点，对显式蒸馏请求触发到对应工具，对公众人物提问触发"X-perspective hijack"。

两者共同表明：当 Skill 数量上规模时，**入口路由与发现成为产品的一等需求**。

---

## 五、通用蒸馏管线设计草案

### 5.1 设计原则

1. **以社区事实标准为骨架**：直接采用"七阶段管线 + 八件套档案"作为内核，不重新发明轮子。
2. **四轴可插拔**：把"人物家族 / 数据源 / 蒸馏配方 / 输出形态"四轴抽象为可独立扩展的注册表。
3. **人在回路是必需而非可选**：Phase 1.5 与 Phase 2.5 默认开启，可被高级用户跳过但不能被默认绕过。
4. **元能力一等公民**：进化、回滚、对照、路由、反向蒸馏的能力，从第一天就纳入领域模型。
5. **复用 ClawPet 已有底座**：Skill/Plugin 体系、多 LLM 路由、CCP 通道、定时任务、MCP 客户端、记忆系统全部可作为基础设施。

### 5.2 顶层架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         前端：蒸馏控制台                             │
│  人物家族选择 │ 数据源连接 │ 配方选择 │ 校验交互 │ 输出预览 │ 演化  │
└────────────┬────────────────────────────────────────────────────────┘
             │ CCP / IPC
┌────────────▼────────────────────────────────────────────────────────┐
│                    主进程：蒸馏编排器（Orchestrator）                │
│  Phase0 意图诊断  │ Phase1 采集器矩阵 │ Phase1.5 采集校验门          │
│  Phase2 提取器矩阵 │ Phase2.5 提取校验门 │ Phase3 装配器             │
│  Phase4 验证器     │ Phase5 发布与演化通道                           │
└────────────┬────────────────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────────────┐
│  注册表层：CharacterFamilyRegistry / SourceRegistry /                │
│            RecipeRegistry / OutputRegistry                           │
└────────────┬────────────────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────────────┐
│  能力层：LLM 路由 │ MCP 工具 │ 浏览器自动化 │ 记忆/Embedding │ 文件 │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.3 四轴可插拔模型

| 轴 | 含义 | 注册表内容 | 示例插件 |
| -- | ---- | ---------- | -------- |
| Character Family | 被蒸馏对象的"家族" | family id、专属 Schema、Layer 0 红线、敏感度等级 | self / partner / colleague / public-figure / fictional / pet / moment |
| Data Source | 数据源接入 | source id、支持的家族、所需凭证、采集器实现、限流策略 | upload / web-fetch / x-api / xhs-api / feishu-bridge / ccp-browser / chat-history |
| Recipe | 蒸馏配方 | recipe id、推荐家族、提取维度、Agentic Protocol 注入策略、validation suite | minimal / mental-model-heavy / relationship-focused / immortal-grade |
| Output Mode | 输出形态 | output id、消费者类型（LLM/人/客户端）、模板路径、命名约定 | persona-skill / perspective / ask / rewrite / html-report / training-data |

注册一个新家族 / 数据源 / 配方 / 输出，只需实现接口并在注册表中声明，无需改动编排器主流程。这与 ClawPet 现有 Skill/Plugin 注册方式天然同构。

### 5.4 关键模块设计

- **意图诊断器（Phase 0）**：参考 `curator-skill`，用一个轻量分类 LLM + 关键词规则输出 `(family, recipe, output)` 初值，再让用户确认或覆盖。
- **采集器矩阵（Phase 1）**：每个数据源是一个 `Collector` 插件，统一返回标准化的 `RawDocument[]`（含来源、时间、可信度等元数据）。优先复用 ClawPet 已有的：浏览器扩展（CCP）、文件拖拽、企业微信桥接、MCP 工具。
- **采集质量门（Phase 1.5）**：默认渲染一份"已采集材料速览"，把"足量 / 时间分布 / 来源等级 / 黑名单命中数"四个指标量化展示，要求用户确认或补料。
- **提取器矩阵（Phase 2）**：每条提取维度是一个 `Extractor`，配方决定开启哪几条以及它们的串并联关系。心智模型抽取强制走"三重门"验证。
- **提取质量门（Phase 2.5）**：暴露字段级编辑器，让用户对心智模型、价值观、Layer 0 红线做合并 / 删除 / 重写。
- **装配器（Phase 3）**：把字段填入 `SKILL.md` 模板；按配方注入 Agentic Protocol；同时按选定的 Output Mode 生成多份产物（扮演 / 视角 / ask / rewrite / 报告）。
- **验证器（Phase 4）**：内置三类测试器（known-answer / edge-case / blind-style），由独立子 Agent 跑批；不达标自动回到 Phase 2 提示用户补强。
- **发布与演化通道（Phase 5）**：以 git 仓库 + 元数据索引承载 Skill；提供 `append` / `correction` / `snapshot` / `rollback` / `compare` 五个原子操作；支持把多个 Skill 注册到一个"角色集合"由 `curator` 统一路由。
- **反向蒸馏与权限模型**：参考 `anti-distill`，为每个字段标注"对外可见 / 仅本人可见 / 私有备份"三档，并把这一标注作为发布时的过滤器。

### 5.5 后端技术栈建议

完全沿用 ClawPet 现有底座，新增模块均以 Go（服务端）+ Electron 主进程（客户端）实现：

- **服务端（`server-go/`）**：新增 `system/persona/`，承担蒸馏任务编排、长任务调度（复用现有 GameLoop / 后台任务系统）、Skill 仓库读写、版本管理（git-go）。
- **客户端主进程**：新增 `electron/persona/`，负责本地数据采集、敏感数据落盘（沿用 `~/.clawpet/` 路径约定）、与 MCP/CCP 工具的桥接。
- **共享类型**：`packages/shared-types` 增加 `persona-*` 模块（family / source / recipe / output / phase / artifact）。
- **前端**：新增独立子窗口 `persona-studio`，遵循 `SubWindowManager` 与 `SubWindowLayout` 规范，提供蒸馏控制台 UI。

### 5.6 用户旅程示例

以"为同事 A 蒸馏一份职场陪伴 Skill"为例：

1. 用户在 ClawPet 主面板调用 `/distill`，意图诊断器识别为 `family=colleague` 并提议 `recipe=relationship-focused`、`output=persona-skill + perspective`。
2. 用户确认后，采集器矩阵展开：勾选企业微信群聊导出、邮件抄送记录、过去 3 个月日程；CCP 浏览器扩展可选地抓取公司内网主页。
3. 采集质量门提示"邮件样本偏少，建议补充近 1 年抄送记录"，用户补料后通过。
4. 提取器矩阵跑出心智模型、表达 DNA、关系网络、Layer 0 红线四张草稿；提取质量门让用户合并两条意思相近的心智模型并删掉一条隐私敏感的关系。
5. 装配器生成 `colleague-A.skill/SKILL.md`，注入 Agentic Protocol 让运行期遇到事实性问题时主动检索内部资料。
6. 验证器跑过 known-answer 与 blind-style 测试，得分 7.8/10；用户接受。
7. Skill 入库；`curator-skill` 自动把"A 怎么看本季度 OKR"的提问路由到该 Skill；用户后续可通过 `append` 不断喂入新邮件。

---

## 六、待决策的关键问题

下列问题需要在进入工程实现前与用户对齐，每一项都会显著影响后续模块设计与 UI 形态：

1. **产品定位**
   - 蒸馏管线是 ClawPet 主功能之一，还是作为独立的"Persona Studio"子产品？
   - 主要面向 C 端（个人数字遗产 / 情感陪伴）还是 B 端（员工知识传承 / 客户洞察）？
2. **核心承诺**
   - 给用户的硬承诺是"高保真模仿"还是"可负责任的视角扩展"？两者对验证器与边界规则的严苛程度差异巨大。
3. **数据与伦理立场**
   - 是否支持蒸馏第三方真人？支持到何种关系亲密度？
   - 默认本地优先还是云端优先？是否支持端到端加密的云端备份？
   - 是否提供"被遗忘权"流程（一键销毁 + 衍生产物追踪）？
4. **技术边界**
   - 是否在第一版就要内置浏览器自动化采集（涉及反爬与风控）？
   - 是否引入本地 SLM 做敏感字段脱敏（避免把私人聊天发上云）？
   - 是否支持把蒸馏结果导出为 OpenClaw / Claude Code / Cursor 兼容格式以扩大宿主面？
5. **生态策略**
   - 是否开放 Recipe 与 Source 插件市场？审核机制如何？
   - 是否原生支持 `awesome-persona-skills` 中的他人 Skill 一键导入？

---

## 七、附录：被引用 Skill 速查

仅列出本报告正文显式引用的 Skill，便于快速回溯。完整清单见 `external-projects/`：

| Skill | 类型 | 关键贡献 |
| ----- | ---- | -------- |
| `nuwa-skill` | 元 | 七阶段管线 + Agentic Protocol + 6 路并行采集 |
| `bggg-skill-taotie` | 元 | Skill 对照进化 |
| `darwin-skill` | 元 | 8 维评分 + git 快照的优化循环 |
| `curator-skill` | 元 | 路由与 X-perspective hijack |
| `anti-distill` | 元 | 反向蒸馏与权限模型 |
| `blogger-distiller` | 元 | 多形态产物（HTML + Skill） |
| `chat_with_me` | 元 | 社交账号一键三模式接入 |
| `immortal-skill` | 元 | 数字永生 7 模板 × 12 平台 × 4 维 + 证据等级 |
| `skill_everyone` | 元/角色 | 虚构角色蒸馏 + 沉浸/视角双输出 |
| `colleague-skill` | 角色族 | 同事/亲密关系采集器矩阵 |
| `boss-skills` | 角色族 | 老板原型 + judgment.md / management.md 输出 |
| `yourself-skill` | 角色 | 自我蒸馏（self.md + persona.md） |
| `digital-life` | 角色 | 数字考古多视角 |
| `ex-skill` | 角色 | 高敏感关系蒸馏的伦理范式 |
| `relic.skill` | 角色 | 万物可蒸馏（soul-forge / engine / shield） |
| `hr-skill` | 功能型 | 人格化业务壳层（拒信/裁员） |
| `elon-musk-skill` | 公众人物 | 心智模型与表达 DNA 的范本 |

---

## 相关文档

- [Skill 系统设计](../skill-system-design.md) —— Skill/Plugin 架构、SKILL.md 规范、自定义 Skill 教程
- [产品设计文档](../../design/product_design.md) —— 产品定位、养成系统、AI 对话系统设计
- [竞品分析文档](competitive_analysis_report.md) —— 桌面宠物 / AI 伴侣项目的技术方案与可复用模块
- 外部参考：[`awesome-persona-skills`](https://github.com/tmstack/awesome-persona-skills)
