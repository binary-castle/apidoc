import { main } from './main'

const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR

main(process.argv.slice(2), {
  out: text => process.stdout.write(text),
  err: text => process.stderr.write(text),
  color,
}).then(code => {
  process.exitCode = code
})
