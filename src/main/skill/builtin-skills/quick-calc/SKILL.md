---
name: quick-calc
description: >
  安全的计算工具：数学表达式求值、单位换算、日期计算。
  当用户需要计算时优先使用此技能，无需弹出确认，即时返回结果。
metadata:
  toolbox:
    version: "1.0.0"
    emoji: "🔢"
    tools:
      - name: quick_calc
        displayName: "快速计算"
        description: |
          快速计算工具，支持三种模式：

          1. evaluate — 数学表达式求值（安全沙箱，支持 +−×÷、幂、百分比、Math 函数）
             示例: expr="8000*0.15", expr="Math.sqrt(144)", expr="2**10"

          2. unit_convert — 单位换算（存储/长度/重量/温度/时间）
             示例: value=128, from="GB", to="MB"
             支持的单位：
             - 存储: B, KB, MB, GB, TB, PB
             - 长度: mm, cm, m, km, in, ft, yd, mi
             - 重量: mg, g, kg, t, oz, lb
             - 温度: C, F, K
             - 时间: ms, s, min, h, d

          3. date_calc — 日期计算
             - mode="diff": 计算两个日期之差。参数: from, to (ISO 日期字符串)
             - mode="add": 日期加减。参数: date, days/hours/minutes
             - mode="weekday": 查某天是星期几。参数: date
             - mode="now": 返回当前精确时间（含时区）

          这是 SAFE 级别工具，无需用户确认。
        inputSchema:
          type: object
          properties:
            action:
              type: string
              description: "计算类型: evaluate | unit_convert | date_calc"
            expr:
              type: string
              description: "数学表达式（evaluate 时使用），如 \"8000*0.15\" \"Math.sqrt(144)\""
            value:
              type: number
              description: "要转换的数值（unit_convert 时使用）"
            from:
              type: string
              description: "源单位（unit_convert 时使用），如 GB、km、kg、C"
            to:
              type: string
              description: "目标单位（unit_convert 时使用），如 MB、mi、lb、F"
            mode:
              type: string
              description: "日期计算模式（date_calc 时使用）: diff | add | weekday | now"
            date:
              type: string
              description: "日期字符串（date_calc 时使用），如 2026-05-01"
            days:
              type: number
              description: "加减天数（date_calc mode=add 时使用）"
            hours:
              type: number
              description: "加减小时数（date_calc mode=add 时使用）"
            minutes:
              type: number
              description: "加减分钟数（date_calc mode=add 时使用）"
          required: [action]
        riskLevel: SAFE
        scriptEntry: scripts/quick-calc.cjs
---

# Quick Calc Skill

安全的计算工具，处理日常计算需求。全部 SAFE 级别，即时返回。

## 使用原则

当用户需要以下计算时，**优先使用此技能**：
- 数学运算（加减乘除、百分比、开方）
- 单位换算（GB→MB、km→mi、℃→℉ 等）
- 日期计算（两日期之差、N天后是几号、星期几）

## 典型场景

- "128GB 等于多少 MB" → `unit_convert` value=128 from=GB to=MB
- "15% 的 8000 是多少" → `evaluate` expr="8000*0.15"
- "今天到五一还有几天" → `date_calc` mode=diff from=今天日期 to=2026-05-01
- "30天后是几号" → `date_calc` mode=add date=今天日期 days=30
- "2026年3月26日是星期几" → `date_calc` mode=weekday date=2026-03-26
