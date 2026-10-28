export const utcMidnight = (date: string) =>
  BigInt(Date.parse(`${date}T00:00:00Z`) / 1000)
