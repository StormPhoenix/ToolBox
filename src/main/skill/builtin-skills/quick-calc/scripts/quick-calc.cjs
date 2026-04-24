/**
 * quick-calc 工具脚本
 * 安全的计算工具：数学求值、单位换算、日期计算
 */

// ========== 数学表达式求值 ==========

/**
 * 安全的数学表达式白名单正则：
 * 只允许数字、运算符、括号、小数点、空格，以及 Math.xxx 函数调用
 */
const SAFE_EXPR_PATTERN = /^[\d\s+\-*/%().^eE,]+$/
const MATH_FUNC_PATTERN = /Math\.(abs|ceil|floor|round|sqrt|cbrt|pow|log|log2|log10|sin|cos|tan|min|max|PI|E|random)\b/g

function safeEvaluate(expr) {
  if (!expr || typeof expr !== 'string') {
    return { success: false, error: '缺少 expr 参数' }
  }

  // 将 Math.xxx 替换为占位符后检查剩余字符
  const stripped = expr.replace(MATH_FUNC_PATTERN, '0')
  if (!SAFE_EXPR_PATTERN.test(stripped)) {
    return {
      success: false,
      error: '表达式包含不安全的字符。只支持数字、运算符(+-*/%)、括号和 Math 函数。',
    }
  }

  try {
    // 使用 Function 构造器在隔离作用域中求值
    const fn = new Function('Math', `"use strict"; return (${expr})`)
    const result = fn(Math)

    if (typeof result !== 'number' || !isFinite(result)) {
      return { success: false, error: `计算结果无效: ${result}` }
    }

    return {
      success: true,
      action: 'evaluate',
      expr,
      result,
      formatted: Number.isInteger(result) ? String(result) : result.toFixed(6).replace(/0+$/, '').replace(/\.$/, ''),
    }
  } catch (err) {
    return { success: false, error: `表达式错误: ${err.message}` }
  }
}

// ========== 单位换算 ==========

/** 单位换算表：所有单位转换为基础单位的乘数 */
const UNIT_TABLE = {
  // 存储（基础单位: Byte）
  B: { base: 'storage', factor: 1 },
  KB: { base: 'storage', factor: 1024 },
  MB: { base: 'storage', factor: 1024 ** 2 },
  GB: { base: 'storage', factor: 1024 ** 3 },
  TB: { base: 'storage', factor: 1024 ** 4 },
  PB: { base: 'storage', factor: 1024 ** 5 },
  // 长度（基础单位: 米）
  mm: { base: 'length', factor: 0.001 },
  cm: { base: 'length', factor: 0.01 },
  m: { base: 'length', factor: 1 },
  km: { base: 'length', factor: 1000 },
  in: { base: 'length', factor: 0.0254 },
  ft: { base: 'length', factor: 0.3048 },
  yd: { base: 'length', factor: 0.9144 },
  mi: { base: 'length', factor: 1609.344 },
  // 重量（基础单位: 克）
  mg: { base: 'weight', factor: 0.001 },
  g: { base: 'weight', factor: 1 },
  kg: { base: 'weight', factor: 1000 },
  t: { base: 'weight', factor: 1000000 },
  oz: { base: 'weight', factor: 28.3495 },
  lb: { base: 'weight', factor: 453.592 },
  // 时间（基础单位: 毫秒）
  ms: { base: 'time', factor: 1 },
  s: { base: 'time', factor: 1000 },
  min: { base: 'time', factor: 60000 },
  h: { base: 'time', factor: 3600000 },
  d: { base: 'time', factor: 86400000 },
  // 温度单独处理
  C: { base: 'temperature' },
  F: { base: 'temperature' },
  K: { base: 'temperature' },
}

function convertTemperature(value, from, to) {
  // 先转为摄氏度
  let celsius
  switch (from) {
    case 'C': celsius = value; break
    case 'F': celsius = (value - 32) * 5 / 9; break
    case 'K': celsius = value - 273.15; break
    default: return null
  }
  // 从摄氏度转为目标
  switch (to) {
    case 'C': return celsius
    case 'F': return celsius * 9 / 5 + 32
    case 'K': return celsius + 273.15
    default: return null
  }
}

function unitConvert(input) {
  const { value, from, to } = input
  if (value == null || !from || !to) {
    return { success: false, error: '需要 value、from、to 三个参数' }
  }

  const fromUnit = UNIT_TABLE[from]
  const toUnit = UNIT_TABLE[to]

  if (!fromUnit) {
    return { success: false, error: `不支持的源单位: ${from}。支持: ${Object.keys(UNIT_TABLE).join(', ')}` }
  }
  if (!toUnit) {
    return { success: false, error: `不支持的目标单位: ${to}。支持: ${Object.keys(UNIT_TABLE).join(', ')}` }
  }
  if (fromUnit.base !== toUnit.base) {
    return { success: false, error: `不能在 ${fromUnit.base} 和 ${toUnit.base} 之间转换（${from} → ${to}）` }
  }

  let result
  if (fromUnit.base === 'temperature') {
    result = convertTemperature(value, from, to)
  } else {
    // 通用转换：value * fromFactor / toFactor
    result = value * fromUnit.factor / toUnit.factor
  }

  if (result == null || !isFinite(result)) {
    return { success: false, error: '转换结果无效' }
  }

  // 智能格式化：大数用整数，小数保留合理精度
  let formatted
  if (Math.abs(result) >= 1) {
    formatted = Number.isInteger(result) ? String(result) : result.toPrecision(10).replace(/0+$/, '').replace(/\.$/, '')
  } else {
    formatted = result.toPrecision(6).replace(/0+$/, '').replace(/\.$/, '')
  }

  return {
    success: true,
    action: 'unit_convert',
    value,
    from,
    to,
    result: Number(formatted),
    formatted: `${value} ${from} = ${formatted} ${to}`,
  }
}

// ========== 日期计算 ==========

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function dateCalc(input) {
  const { mode } = input

  switch (mode) {
    case 'now': {
      const now = new Date()
      return {
        success: true,
        action: 'date_calc',
        mode: 'now',
        date: now.toLocaleDateString('zh-CN'),
        time: now.toLocaleTimeString('zh-CN'),
        weekday: `星期${WEEKDAYS[now.getDay()]}`,
        iso: now.toISOString(),
        timestamp: now.getTime(),
      }
    }

    case 'diff': {
      const { from, to } = input
      if (!from || !to) {
        return { success: false, error: 'mode=diff 需要 from 和 to 参数' }
      }
      const d1 = new Date(from)
      const d2 = new Date(to)
      if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
        return { success: false, error: '日期格式无效，请使用 YYYY-MM-DD 格式' }
      }
      const diffMs = d2.getTime() - d1.getTime()
      const diffDays = Math.round(diffMs / 86400000)
      return {
        success: true,
        action: 'date_calc',
        mode: 'diff',
        from: d1.toLocaleDateString('zh-CN'),
        to: d2.toLocaleDateString('zh-CN'),
        diffDays,
        diffHours: Math.round(diffMs / 3600000),
        formatted: `${d1.toLocaleDateString('zh-CN')} 到 ${d2.toLocaleDateString('zh-CN')} 相差 ${Math.abs(diffDays)} 天`,
      }
    }

    case 'add': {
      const { date, days, hours, minutes } = input
      const base = date ? new Date(date) : new Date()
      if (isNaN(base.getTime())) {
        return { success: false, error: '日期格式无效' }
      }
      let totalMs = 0
      if (days) totalMs += days * 86400000
      if (hours) totalMs += hours * 3600000
      if (minutes) totalMs += minutes * 60000
      const result = new Date(base.getTime() + totalMs)
      return {
        success: true,
        action: 'date_calc',
        mode: 'add',
        baseDate: base.toLocaleDateString('zh-CN'),
        resultDate: result.toLocaleDateString('zh-CN'),
        resultTime: result.toLocaleTimeString('zh-CN'),
        weekday: `星期${WEEKDAYS[result.getDay()]}`,
        iso: result.toISOString(),
      }
    }

    case 'weekday': {
      const { date } = input
      if (!date) {
        return { success: false, error: 'mode=weekday 需要 date 参数' }
      }
      const d = new Date(date)
      if (isNaN(d.getTime())) {
        return { success: false, error: '日期格式无效' }
      }
      return {
        success: true,
        action: 'date_calc',
        mode: 'weekday',
        date: d.toLocaleDateString('zh-CN'),
        weekday: `星期${WEEKDAYS[d.getDay()]}`,
        dayOfWeek: d.getDay(),
      }
    }

    default:
      return { success: false, error: `不支持的 mode: ${mode}。支持: diff, add, weekday, now` }
  }
}

// ========== 入口 ==========

async function execute(input, context) {
  const { action } = input

  switch (action) {
    case 'evaluate':
      return safeEvaluate(input.expr)
    case 'unit_convert':
      return unitConvert(input)
    case 'date_calc':
      return dateCalc(input)
    default:
      return { success: false, error: `不支持的 action: ${action}。支持: evaluate, unit_convert, date_calc` }
  }
}

module.exports = { execute }
