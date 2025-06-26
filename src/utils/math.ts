export class MathHelper {
  private eps = 1e-10

  getPricePrecision(price: string) {
    let use = price
    // if price exp fromat, 1e-7
    if (price.indexOf('e-') !== -1) {
      use = Number(price).toFixed(parseFloat(price.split('e-')[1]))
    }
    // if price have no 1, 0.00025
    if (use.indexOf('1') === -1) {
      const dec = use.replace('0.', '')
      const numbers = dec.replace(/0/g, '')
      const place = dec.indexOf(numbers)
      if (place <= 1) {
        return place
      }
      //0.0000025
      use = `0.${'0'.repeat(place - 1)}1`
    }
    return use.indexOf('1') === 0 ? 0 : use.replace('0.', '').indexOf('1') + 1
  }

  convertFromExponential(num: number | string, precision = 2) {
    return Number(num).toFixed(Math.min(precision, 20)).replace(/0*$/, '')
  }
  round(_num: number, precision = 2, down = false, up = false) {
    let num = `${_num}`
    if (`${_num}`.indexOf('e') !== -1) {
      num = this.convertFromExponential(_num, precision + 2)
    }
    const intPart = num.split('.')[0]
    if ((intPart?.length ?? 0) + precision > 20) {
      precision = 20 - intPart.length
    }
    if (down) {
      return Number(
        Math.floor(Number(num + 'e' + precision)) + 'e-' + precision,
      )
    }
    if (up) {
      return Number(Math.ceil(Number(num + 'e' + precision)) + 'e-' + precision)
    }
    return Number(Math.round(Number(num + 'e' + precision)) + 'e-' + precision)
  }

  isZero(a: number) {
    return Math.abs(a) <= this.eps
  }

  lte(a: number, b: number) {
    return (!this.isZero(a - b) && a <= b) || this.isZero(a - b)
  }

  countDecimals(number: number) {
    const str = number.toString()
    if (str.indexOf('.') !== -1) {
      return str.split('.')[1]?.length ?? 0
    }
    return 0
  }

  remainder(a: number, b: number) {
    const e = this.countDecimals(b)
    const multiplier = Number(`1e${e}`)
    return ((a * multiplier) % (b * multiplier)) / multiplier
  }

  stDev(array: number[]) {
    const n = array.length
    const mean = array.reduce((a, b) => a + b, 0) / n
    return Math.sqrt(
      array.map((x) => (x - mean) ** 2).reduce((a, b) => a + b, 0) / n,
    )
  }

  downsideStDev(array: number[], MAR = 2) {
    const mar = MAR / 100
    const DD = Math.sqrt(
      array.reduce((acc, v) => (acc += Math.min(0, v - mar) ** 2), 0) /
        array.length,
    )
    return DD
  }

  sharpeRatio(
    profit: number[],
    denominator: number,
    periodRatio: number,
    RFR = 2,
  ) {
    const profitPercByPeriod = profit.map((v) => v / denominator)
    const MR =
      profitPercByPeriod.reduce((acc, v) => (acc += v), 0) /
      profitPercByPeriod.length
    const SD = this.stDev(profitPercByPeriod)
    const rfr = RFR / 100 / periodRatio
    return SD !== 0 ? this.round((MR - rfr) / SD, 3) : 0
  }

  santinoRatio(
    profit: number[],
    denominator: number,
    periodRatio: number,
    RFR = 2,
    MAR = 7,
  ) {
    const profitPercByPeriod = profit.map((v) => v / denominator)
    const MR =
      profitPercByPeriod.reduce((acc, v) => (acc += v), 0) /
      profitPercByPeriod.length
    const rfr = RFR / 100 / periodRatio
    const mar = MAR / 100 / periodRatio
    const DD = Math.sqrt(
      profitPercByPeriod.reduce(
        (acc, v) => (acc += Math.min(0, v - mar) ** 2),
        0,
      ) / profitPercByPeriod.length,
    )
    return DD !== 0 ? this.round((MR - rfr) / DD, 3) : Infinity
  }

  convertString(s: string | number) {
    const tmp = parseFloat(`${s}`)
    return isNaN(tmp) ? 0 : tmp
  }
}
