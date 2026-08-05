let strs = ["Akshay", "ravish"]

function encode(strs) {
  let result = ''
  for (const item of strs) {
    result += item.length + '#' + item
  }
  return result
}

encode(strs)

function decode(str = '6#Akshay6#ravish') {
  let result = []
  let i = 0
  while (i < str.length) {
    let l = i
    while (str[l] !== '#') {
      l += 1
    }
    let count = parseFloat(str.slice(i, l))
    let start = l + 1
    let strs = str.slice(start, start + count)
    result.push(strs)
    i = start + count
  }
  return result
}

decode()