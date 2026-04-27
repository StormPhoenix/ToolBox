# 需求 Backlog

> 记录待评估 / 待开发的需求想法，不代表已确定优先级或排期。
> 真正立项开发时，从本文件摘出并单独创建详细设计文档。

---

## 平台能力

- [ ] **插件 LLM 接口规范** — 制定插件侧向 LLM 暴露工具的接口标准，使插件能声明可被 LLM 调用的能力（类似 Skill 系统，但面向插件生态，扩展 Agent 的桌面工具集）；问题分析见 [`docs/design/plugin-llm-interface-design.md`](plugin-llm-interface-design.md)
- [ ] **LLM 思维角色（Persona）Chat 集成** — Persona Studio（已立项，见 [`docs/design/persona-studio-design.md`](persona-studio-design.md)）发布的 SKILL.md 天然满足 `kind=persona` 派生条件（无工具声明），待本期实现后即可在 Chat 角色选择器中使用：把「工具能力」与「角色 / 思维方式」解耦为正交两轴，在 `chat` / `agent` / `deep` 任意模式下允许会话级单选一个 `kind=persona` 的 Skill 注入到 system prompt，独立于工具开关。详细需求规格见 [`docs/design/persona-feature-design.md`](persona-feature-design.md)
- [ ] **工具后台静默运行** — Toolbox 工具支持在无前台窗口的情况下持续运行（如定时任务、文件监听、剪贴板监控），不依赖用户打开插件界面

---

## Persona Studio 后续扩展

> Persona Studio 核心功能（材料收集 → 蒸馏 → 持久化 → 发布为 Skill）已立项，见 [`docs/design/persona-studio-design.md`](persona-studio-design.md)。以下为待评估的扩展方向。

- [ ] **配方自定义提取 prompt** — 在 `RECIPE.md` frontmatter 中增加可选字段 `metadata.toolbox.recipe.extraction_prompt`，允许配方作者覆盖全局 `extraction-prompt.md`，适配需要特定提取策略的配方（如专注情感记忆的关系类配方）
- [ ] **增量补材料** — 对已有 Persona 追加新材料后触发局部重蒸馏，产出 diff 供用户合并到现有 SKILL.md，而非全量重跑
- [ ] **快照与版本回退** — `userData/personas/<id>/snapshots/` 子目录，每次保存/发布前打快照，支持回退到历史版本
- [ ] **多输出模式** — 一次蒸馏同时产出 perspective（第三人称分析）和 ask（知识库问答）两种变体 Skill，实现"一份蒸馏，三种消费方式"
- [ ] **agentic 配方运行模式扩展** — 当前 Persona Studio 为"单次离线蒸馏"环境，外部生态中存在大量为 agentic 宿主（Claude Code / OpenClaw / Hermes 等）设计的 Skill 配方（典型案例：[`nvwa-skill`](https://github.com/xmg2024/nvwa-skill)），它们假设具备多轮对话、subagent 派生、文件读写、`WebSearch` / `bash` 等工具调用、用户检查点确认等能力。当前的处理策略与未来扩展方向：

  **当前实现的兜底机制（V1）**：在 `distiller.ts` 的合成阶段注入 `SYNTHESIS_SYSTEM_CONSTRAINT`（追加到配方 system prompt 末尾）+ `SYNTHESIS_USER_CONTRACT`（追加到 user message 末尾）双重约束，强制 LLM 跳过配方中的多步流程指令，直接产出最终 SKILL.md。这是有损方案——agentic 配方设计的 Phase 1.5 / Phase 2.5 等检查点在单次模式下无法触发，蒸馏质量天然受限。

  **当前推荐的用户路径**：对于复杂的 agentic 配方（如 nvwa-skill），建议用户在原宿主（Claude Code 等）执行完整流程，得到成品 SKILL.md，再放入 `userData/skills/<id>/` 目录由 Skill 系统直接加载消费，而非通过 Persona Studio 蒸馏。Persona Studio 主要服务于"单次离线蒸馏配方"（如本项目的 4 个内置配方）。

  **未来扩展方向（V2/V3）**：引入"运行模式"概念，按配方能力需求分级支持：
    - `single-pass`（V1 已实现）：单次合成，无工具
    - `tool-aided`（V2）：单 LLM 路径暴露白名单工具——`sandbox_write` / `sandbox_read`（限制在 `userData/personas/<id>/sandbox/` 内）+ `web_fetch`，让配方能补充查证而不威胁本地数据
    - `agent-loop`（V3）：完整 agent 循环 + 沙盒 + 工具白名单 + 资源限额（最多 N 次工具调用、单次 sandbox 写入大小限制等），类似 Chat 的 deep 模式但严格沙盒化。安全模型需要专门设计：路径越界拒绝、网络白名单、运行时审计、用户确认 UI

---

## 桌面效率

- [ ] **认知清洁工** — Agent 扫描指定目录，根据文件内容（而非仅后缀）自动分类、重命名、归档，如识别图片主题、将 PDF 按合同/账单分类并用日期+标题重命名
- [ ] **发票提取器** — 批量读取发票图片/PDF，LLM 提取日期/金额/商户/明细，自动写入 Excel 账本或生成报销申请单
- [ ] **项目时光机** — 监控当天被打开/修改的办公文件，结合文件名与内容摘要，自动生成"今日工作草稿"，用于日报/周报
- [ ] **会议留声机** — 导入录音文件，Agent 转写并总结，提取各参与者 TODO 写入行动跟踪表，并在相关项目目录生成提醒文件
- [ ] **剪贴板智能工坊** — 开启剪贴板监听，根据内容类型自动触发 Skill：英文润色/翻译、错误日志分析、地名信息聚合等，结果本地沉淀
- [ ] **桌面配方 / 快捷指令** — 类 iOS 快捷指令的可视化积木式编排器，将 Skill、插件能力、系统操作组合为可复用的工作流；支持全局快捷键快速召唤，也可在后台自动触发形成自动化管道

---

## 学习辅助

- [ ] **论文解剖器** — 拖入长文档，Agent 边读边生成大纲/思维导图、苏格拉底式追问记录、费曼解释，学习笔记自动落盘
- [ ] **学习磁卡** — 选中文档或文本，Agent 生成问答对并导出为 Anki 兼容 CSV，可进阶为定期从学习目录抽取旧材料推送测验
- [ ] **代码库故事官** — 遍历本地项目，读取文件结构与关键代码，生成 `PROJECT_OVERVIEW.md`，并支持"这个项目里 X 流程在哪？"的交互问答
- [ ] **桌面辩论赛** — 对指定资料文件夹启动"辩论模式"，Agent 扮演正反方与用户三方辩论，记录为 `debate_transcript.md` 并生成多视角总结

---

## 认知提升

- [ ] **思想格斗场** — 输入一个观点，Agent 扮演原著作者/对立学派/跨界专家三方分别反驳，多轮辩论后生成认知漏洞报告和升级后新观点
- [ ] **反常识制造机** — 拖入近期阅读笔记，Agent 提取关键假设并收集/生成高质量反面论据，输出"挑战你的观念.md"
- [ ] **费曼教练** — 让用户用最简单语言解释概念，Agent 识别模糊词和逻辑跳跃追问，最终生成费曼学习报告（初始解释/漏洞/修正/类比）
- [ ] **跨学科类比引擎** — 输入任意概念，Agent 强制从生物/物理/计算机/历史等学科生成类比，输出"跨界镜像卡.md"
- [ ] **书籍 DNA 提取器** — 将书籍摘录喂给 Agent，三层蒸馏：思维模型卡 / 内部矛盾点 / 行动检查表，纳入个人方法论库
- [ ] **心智维基** — 定期扫描笔记目录，LLM 识别概念间隐蔽联系，自动更新知识图谱文件，并在学习时主动推送相关旧笔记
- [ ] **认知偏见断路器** — 常驻 Skill，对写作/分析文本扫描认知偏误（可得性启发/沉没成本等），高亮标注并生成引导性追问，保存决策审计记录
- [ ] **思想历史学家** — 按时间线分析所有笔记和辩论记录中的观点演变，生成认知变迁河流图，绘制个人"认知资产负债表"
