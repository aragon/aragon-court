const printTable = (title, rows) => {
  const header = rows[0]
  const columnsMaxLengths = rows.reduce((maxLengths, row) =>
    row.map((cell, i) => Math.max(cell.length, maxLengths[i])),
  header.map(() => 0)
  )

  const formattedHeader = header.map((cell, i) => cell.padEnd(columnsMaxLengths[i], ' '))
  const formattedHeaderDiv = header.map((cell, i) => '-'.padEnd(columnsMaxLengths[i], '-'))
  const formattedBody = rows.slice(1).map(row => row.map((cell, i) => cell.padStart(columnsMaxLengths[i], ' ')))

  console.log(`\n${title}\n`)
  console.log(`| ${formattedHeader.join(' | ')} |`)
  console.log(`|-${formattedHeaderDiv.join('-|-')}-|`)
  formattedBody.forEach(row => console.log(`| ${row.join(' | ')} |`))
}

module.exports = {
  printTable
}
