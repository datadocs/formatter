
import {
  Condition, 
  ConditionalFormat, 
  FixedFormat, 
  IntegerFormat, 
  MaskedNumber, 
  ScientificFormat, 
  GenericFormat, 
  FractionFormat, 
  parse,
  MultiFormat,
  DigitMask,
  MaskedNumericToken,
  DateTimeFormat,
  TimeToken
} from './parse-format'

export function compileCondition(cond: Condition, n: string): string {
  if(cond === null){
    return 'true'
  }
  switch(cond.compare){
    case '<>':return `(${n} !== ${cond.value})`;
    case '=':return `(${n} === ${cond.value})`;
    case '<': return `(${n} < ${cond.value})`;
    case '<=': return `(${n} <= ${cond.value})`;
    case '>=': return `(${n} >= ${cond.value})`;
    case '>': return `(${n} > ${cond.value})`;
  }
}
function stringDisplay(p: MaskedNumericToken){
  if(p.type === 'separator' && p.mask === ','){
    return ''
  }else if(p.type === 'hidden'){
    return ''.padEnd((p.mask || '').length, ' ')
  }else{
    return p.mask || ''
  }
}


// Positions to add separators, rule for western English
const separatorAt = (i:number) => (i > 0) && (i % 3 === 0)

export function formatMaskedNumber(f: MaskedNumber, s: string, sMasked: string, thousandSeparator: string, code: string[]): void {
  code.push(`let ${sMasked} = '';`);
  code.push(`${s} = ${s}.replace(/^0+/, '');`)
  if(f.firstReserved !== null){
    code.push(`${s} = ${s}.padStart(${f.totalPositions - f.firstReserved}, '0');`);
  }
  code.push('{ // formatMaskedNumber');
  if(thousandSeparator){
    code.push('const separatorAt = ' + separatorAt.toString() + ';');
  }
  code.push('let dStart = 0;');
  code.push(`let dEnd = ${s}.length - ${f.totalPositions - 1};`)
  for(const p of f.parts){
    switch(p.type){
      case 'digit':
        code.push(`
        if(dStart < ${s}.length){
          for(;dStart < dEnd; ++dStart){
            ${sMasked} += ${s}[dStart];`)
        if(thousandSeparator){
          code.push(`
            if(separatorAt(${s}.length - dStart - 1)){
              ${sMasked} += ${JSON.stringify(thousandSeparator)};
            }`);
        }
        code.push(`
          }
          if(dEnd > 0){
            dStart = dEnd
          }
          ++dEnd;
       }`);
        break;
      default:
        code.push(`${sMasked} += ${JSON.stringify(stringDisplay(p))}`);
        break;
    }
  }
  code.push(`
      } // formatMaskedNumber`)
}

export function formatLeftAlignedMaskedNumber(f: MaskedNumber, s: string, sMasked: string, code: string[]): void {
  code.push(`let ${sMasked} = '';`)
  if(f.lastReserved !== null){
    code.push(`${s} = ${s}.padEnd(${f.lastReserved + 1}, '0');`)
  }
  code.push('{ // formatLeftAlignedMaskedNumber')
  code.push('let dPos = 0;')
  for(const p of f.parts){
    switch(p.type){
      case 'digit':
        code.push(`
        if(dPos < ${s}.length) {
          ${sMasked} += ${s}[dPos++];
        }
        `)
        break;
      default:
        code.push(`${sMasked} += ${JSON.stringify(stringDisplay(p))}`);
        break
    }
  }
  code.push('} // formatLeftAlignedMaskedNumber')
}

export function applyScale(f: FixedFormat | IntegerFormat, n: string, code: string[]): void {
  const x =  2 * (f.numPercentSymbols || 0) - 3 * (f.numTrailingCommas || 0)
  if(x !== 0){
    code.push(`${n} *= ${Math.pow(10, x)}`)
  }
}

export function formatFixed(f: FixedFormat, n: string, ans: string, code: string[]): void {
  code.push('{ // formatFixed')
  applyScale(f, n, code)
  code.push(`let [int,dec] = Math.abs(${n}).toFixed(${f.decimal.totalPositions}).split('.')`)
  code.push(`const sig = ${n} < 0 ? '-' : ''`);
  formatMaskedNumber(f.int, 'int', 'intm', f.thousandSeparator, code)
  code.push(`dec = dec.replace(/0+$/, '')`)
  formatLeftAlignedMaskedNumber(f.decimal, 'dec', 'decm', code);
  code.push(`${ans} = sig + intm + '.' + decm;`)
  code.push(`} // formatFixed`)
}

export function formatInteger(f: IntegerFormat, n: string, ans: string, code: string[]): void {  
  code.push('{ // formatInteger')
  applyScale(f, n, code)
  code.push(`const sig = ${n} < 0 ? '-' : '';`);
  code.push(`let int = Math.abs(${n}).toFixed(0);`);
  formatMaskedNumber(f.int, 'int', 'intm', f.thousandSeparator, code);
  code.push(`${ans} =  sig + intm`);
  code.push(`} // formatInteger`)
}

export function formatScientific(f: ScientificFormat, n: string, ans: string, code:string[]): void {
  const alignment = f.mantissa.int.totalPositions;
  code.push('{ // formatScientific')
  code.push(`let s = ''`)
  if(alignment){
    code.push(`let exponent = ${alignment} * Math.floor(Math.log10(Math.abs(${n})) / ${alignment})`)
  }else{
    code.push(`let exponent = Math.ceil(Math.log10(${n}))`);
  }
  code.push(`${n} *= Math.pow(10, -exponent)`)

  if(f.mantissa.type == 'fixed'){
    formatFixed(f.mantissa, n, ans, code)
  }else{
    formatInteger(f.mantissa, n, ans, code);
  }
  code.push(`${ans} += 'E' + (exponent >= 0? ${JSON.stringify(f.exponent.sign === '+' ? '+': '')} : '-');`)
  code.push(`let exs = Math.abs(exponent).toFixed(0);`);
  formatMaskedNumber(f.exponent.mask, 'exs', 'exsm', '', code);
  code.push(`${ans} += exsm;`)
  code.push('} // formatScientific')
  console.log(code.join('\n'))
}

  type FractionalRepresentation = {
    intPart: number,
    numerator: number,
    denominator: number
  }

  /**
   * Find a reasonably good rational approximation for the given number
   * more efficiently than Stern Brocot tree.
   * This is not optimal, but it matches the Excel behavior
   * @param {number} n 
   * @param {number} denominatorLimit 
   * @returns {RationalApproximation}
   */
   function continuedFractionSearch(n: number, denominatorLimit: number):
   FractionalRepresentation
   {
    let p0 = 0, q0 = 1, p1 = 1, q1 = 0
    let af = n;
    const quotients = []

    // The path in the Stern-Broccot tree could be expressed as 
    // L+L+L+....+L+R+R...+R, and compressed as a series of steps
    //   Take Right a1 times, 
    //   then Left a2 times,
    //   Then Right a3 times,
    //   and so on.
    // This algorithm will, each iteration will start from
    // p0/q0 and take `a` steps, the maximum number of steps
    // possible before changing direction.
    
    for(let i = 0; i < 20; ++i){
      let a = Math.floor(af)
      // This is equivalent to giving a steps 
      // from p0/q0 to the direction of p1/q1
      const q2 = q0 + a * q1;
      const p2 = p0 + a * p1;
      if(q2 > denominatorLimit){
        break;
      }
      // Now q1 will be the starting node
      p0 = p1;
      q0 = q1;
      p1 = p2;
      q1 = q2;
      if(af == a){
        return {intPart: ~~n, numerator: p1 % q1, denominator: q1};
      }
      af = 1/(af - a)
    }
    // Maybe the performing all the steps before changin
    // direction would exceed result in a fraction that 
    // violates the denominatorLimimt, but still would
    // be possible to give some steps
    // 
    // Let k be the maximum integer such that 
    //    q0+k*q1 < denominatorLimit
    // then k could be computed as 
    //    k = floor((denominatorLimit - q0)/q1)
    // the value (p0+k*p1) / (q0+k*q1) gives a better
    // approximation to n than p1/q1, and maybe better
    // than p0/q0.
    // 
    // It seems that this step is what what excel
    // is not doing

    if(Math.abs(p1/q1 - n) < Math.abs(p0/q0 - n)){
      return {intPart: ~~n, numerator: p1 % q1, denominator: q1}
    }else{
      return {intPart: ~~n, numerator: p0 % q0, denominator: q0}
    }
  }
function fixedFractionSearch(n: number, denominator: number): FractionalRepresentation {
  let numerator = Math.round(Math.abs(n) * denominator)
  let intPart = numerator / denominator;
  numerator -= intPart * denominator;
  return {intPart, numerator, denominator}
}
function formatFraction(f: FractionFormat, n: string, code: string[]): void {
  
  // let s = n < 0 ? '-' : ''
  // const {numerator, denominator} = f.fraction;
  // let denominator_s
  // let v: FractionalRepresentation
  // n = Math.abs(n);
  // if(typeof denominator === 'object'){
  //   v = continuedFractionSearch(n, Math.pow(10, denominator.totalPositions)-1);
  //   denominator_s = formatMaskedNumber(denominator, v.denominator.toFixed(), '');
  // }else{
  //   v = fixedFractionSearch(n, denominator)
  //   denominator_s = denominator.toFixed(0)
  // }
  // if(f.int){
  //   s += formatMaskedNumber(f.int, v.intPart.toFixed(0), '')
  // }else{
  //   v.numerator += v.denominator * v.intPart;
  //   v.intPart = 0 // only for consistency
  // }
  
  // s += formatMaskedNumber(numerator, v.numerator.toFixed(0), '')
  // s += '/' + denominator_s;
  // return s;
}


const weekDays = [
  'Sunday', 'Monday', 'Tueseday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
]
const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'
]

function ampm(date:Date): string{
  return (((date.getUTCHours() + 23) % 24) < 12) ? 'am': 'pm'
}

export function excelDateToJSDate(days: number):Date {
  // There are two differences between javascript date 
  // serialization and excel date serialization
  //
  // 1. The origin
  //   Javascript zero origin is 01/01/1970 00:00
  //   Excel zero is 31/12/1899 00:00 
  //    * curiously it will be formatted as 00/01/1900
  //    * 1900 is counted as a leap year, i.e. it as if
  //      29/02/1900 existed.
  //
  //   So we subtract
  //     70*365 - the 70 years
  //    +    17 - leap years
  //    +     1 - 29/02/1900 (that never existed)
  //    +     1 - 31/12/19
  //    = 25569 
  // 2. The scale
  //   Javascript counts milliseconds
  //   Excel counts days
  //   So we multiply by
  //        24 hours / day
  //    *   60 minutes / hour
  //    *   60 seconds / minute
  //    * 1000 milliseconds / second
  //    = 86400000 milliseconds / day
  return new Date(Math.round((days - 25569)*864e5));
}
const excelDateOrigin = excelDateToJSDate(0).getTime();

export function jsDateToExcelDate(date: Date): number {
  return 25569.0 + ((date.getTime() - (date.getTimezoneOffset() * 60 * 1000)) / (1000 * 60 * 60 * 24));
}
function formatDate(f:DateTimeFormat, date: Date): string {
  return f.parts.map((t) => {
    switch(t.type) {
      case 'time':
        switch(t.mask){
          case 'm':
          case 'mm':
            return date.getUTCMinutes().toString().padStart(t.mask.length, '0')
          case 'h':
          case 'hh':
            return ((f.clockHours === 12) 
              ? (((date.getUTCHours() + 11) % 12) + 1) 
              : date.getUTCHours()
            ).toString().padStart(t.mask.length, '0')
          case 's':
          case 'ss':
            return date.getUTCSeconds().toString().padStart(t.mask.length, '0')
          case '.0':
            return (date.getUTCMilliseconds() / 1000).toFixed(t.zfill).substring(1)
          case '[s]':
            return Math.floor((date.getTime() - excelDateOrigin)/1e3).toString().padStart(t.zfill, '0')
          case '[m]':
            return Math.floor((date.getTime() - excelDateOrigin)/6e4).toString().padStart(t.zfill, '0')
          case '[h]':
            return Math.floor((date.getTime() - excelDateOrigin)/3.6e6).toString().padStart(t.zfill, '0')
          case 'am/pm':
            return ampm(date)
          case 'a/p':
            return ampm(date)[0];
          /* istanbul ignore next */
          default:
            throw TypeError('Invalid time mask: ' + JSON.stringify(t))
        }
      case 'date':
        switch(t.mask){
          case 'yyyy':
          case 'eeee':
            return date.getUTCFullYear().toString();
          case 'yy':
          case 'ee':
            return (date.getUTCFullYear() % 100).toString()
          case 'm':
          case 'mm':
            return (date.getUTCMonth() + 1).toString().padStart(t.mask.length, '0');
          case 'd':
          case 'dd':
            return date.getUTCDate().toString().padStart(t.mask.length, '0')
          case 'ddd':
            return weekDays[date.getUTCDay()].slice(0,3);
          case 'dddd':
            return weekDays[date.getUTCDay()]
          case 'mmm':
            return monthNames[date.getUTCMonth()].slice(0, 3)
          case 'mmmm':
            return monthNames[date.getUTCMonth()]
          case 'mmmmm':
            return monthNames[date.getUTCMonth()][0]
          /* istanbul ignore next */
          default:
            throw TypeError('Invalid date mask: ' + JSON.stringify(t))
        }
      case 'hidden':
        return ' ';
      case 'literal':
        return t.mask;
      /* istanbul ignore next */
      default:
        throw TypeError('Invalid token type for date: ' + t.type)
    }
  }).join('');
}

function applyFormat(f: GenericFormat, n: string, ans: string, code: string[]): void {
  switch(f.type){
    case 'scientific':
      return formatScientific(f, n, ans, code);
    case 'fixed':
      return formatFixed(f, n, ans, code);
    case 'integer':
      return formatInteger(f, n, ans, code);
    case 'fraction':
      // return formatFraction(f, n);
    case 'datetime':
      // return formatDate(f, excelDateToJSDate(n))
  }
  // return n.toString()
}

function compileConditional(f: ConditionalFormat[]): (n: number) => string{
  const code = ['// Update 1']
  for(const fi of f){
    const c = compileCondition(fi.condition, 'n')
    code.push(`
    if(${c}){
      let ans;`);
      applyFormat(fi.format, 'n', 'ans', code);
    code.push(`
      return ans;
    }`)
  }
  code.push(`return n.toString();`)
  return new Function('n', code.join('\n')) as (n: number) => string;
}
export class CompiledTextRenderer {
  _format_string: string;
  _format_data: MultiFormat;
  formatNumber: (n: number) => string;
  constructor(format:string){
    this._format_string = format;
    this._format_data = parse(format)
    this.formatNumber = compileConditional(this._format_data)
  }
}