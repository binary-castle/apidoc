// Not imported from ./sandbox: that would put shared code in a chunk the service worker can't load.
const SANDBOX_ORIGIN = 'https://api.sandbox.orbit.dev'
const PETSTORE = 'https://petstore3.swagger.io/api/v3/openapi.json'

const params = new URLSearchParams(window.location.search)
const choice = params.get('spec') ?? 'orbit'
const theme = params.get('theme')

const docs = document.getElementById('docs')!
const picker = document.getElementById('spec-picker') as HTMLSelectElement
const form = document.getElementById('custom-form') as HTMLFormElement
const input = document.getElementById('custom-url') as HTMLInputElement
const note = document.getElementById('note')!

if (theme === 'dark' || theme === 'light') {
  docs.setAttribute('theme', theme)
  document.documentElement.dataset.theme = theme
}

function load(spec: string) {
  const url = new URL(window.location.href)
  if (spec === 'orbit') url.searchParams.delete('spec')
  else url.searchParams.set('spec', spec)
  url.hash = ''
  window.location.href = url.toString()
}

picker.addEventListener('change', () => {
  if (picker.value === 'custom') {
    form.hidden = false
    input.focus()
  } else {
    load(picker.value)
  }
})
form.addEventListener('submit', event => {
  event.preventDefault()
  load(input.value.trim())
})

if (choice === 'orbit') {
  picker.value = 'orbit'
  docs.setAttribute('spec-url', 'specs/orbit.yaml')
  // The previous release, for the changelog, and runnable workflows.
  docs.setAttribute('versions', JSON.stringify([{ version: '2.3.0', url: 'specs/orbit-2.3.0.yaml', date: '2026-09-18' }]))
  docs.setAttribute('workflows-url', 'specs/orbit.arazzo.yaml')
  note.textContent = 'Requests to the sandbox server are answered inside your browser. Try "Retrieve a customer" for a contract warning.'
  void startSandbox()
} else if (choice === 'petstore') {
  picker.value = 'petstore'
  docs.setAttribute('spec-url', PETSTORE)
  note.textContent = 'Live requests to petstore3.swagger.io.'
} else {
  picker.value = 'custom'
  form.hidden = false
  input.value = choice
  docs.setAttribute('spec-url', choice)
  note.textContent = '"Try it" works when the API allows cross-origin requests.'
}

// The published bundle, exactly as users load it from npm or a CDN.
void import(/* @vite-ignore */ new URL('apidoc/apidoc.js', document.baseURI).href)

// --- Branding: accent swatches, a colour picker and the Orbit logo -------------

const accentInput = document.getElementById('accent-input') as HTMLInputElement
const swatches = [...document.querySelectorAll<HTMLButtonElement>('.swatch[data-brand]')]

function applyBrand(brand: string) {
  const orbit = brand === 'orbit'
  const accent = orbit ? '#14b8a6' : brand
  if (accent) docs.setAttribute('accent', accent)
  else docs.removeAttribute('accent')
  if (orbit) {
    docs.setAttribute('logo', 'brand/orbit-light.svg')
    docs.setAttribute('logo-dark', 'brand/orbit-dark.svg')
  } else {
    docs.removeAttribute('logo')
    docs.removeAttribute('logo-dark')
  }
  for (const swatch of swatches) swatch.setAttribute('aria-pressed', String(swatch.dataset.brand === brand))
  if (/^#[0-9a-f]{6}$/i.test(accent)) accentInput.value = accent
  // Keep the choice in the URL so it can be shared.
  const url = new URL(window.location.href)
  if (brand) url.searchParams.set('brand', brand)
  else url.searchParams.delete('brand')
  history.replaceState(history.state, '', url)
}

for (const swatch of swatches) swatch.addEventListener('click', () => applyBrand(swatch.dataset.brand ?? ''))
accentInput.addEventListener('input', () => applyBrand(accentInput.value))
applyBrand(params.get('brand') ?? params.get('accent') ?? '')

/** The service worker answers requests to the Orbit sandbox server. */
async function startSandbox() {
  if (!('serviceWorker' in navigator)) {
    note.textContent = `This browser can't run the in-browser sandbox, so requests to ${SANDBOX_ORIGIN} will fail.`
    return
  }
  try {
    await (import.meta.env.DEV
      ? navigator.serviceWorker.register('/src/sw.ts', { type: 'module' })
      : navigator.serviceWorker.register('./sw.js'))
  } catch (error) {
    note.textContent = `The in-browser sandbox didn't start (${(error as Error).message}).`
  }
}
