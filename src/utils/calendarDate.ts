// 「X月X日」日历日期文案单一出口（多语言文案收口批）：无前导零、本地时区。
// 沿 #279「剩余 X 分钟」先例——纯函数放 utils、copy 槽位只委托，页面/组件不各自拼串。
// 现有调用方：Parent 最近答题日期、Prizes 奖品相对日期标注（Prizes 本地 monthDay 改为委托本函数）。

export function monthDayText(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
