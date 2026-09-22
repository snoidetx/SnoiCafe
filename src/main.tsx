import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App, type DemoControls } from './App'
import { createRepository } from './lib/repository'
import { supabase } from './lib/supabase'
import type { Repository } from './types'
import './styles.css'
async function start() {
  let repository: Repository | undefined, demo: DemoControls | undefined
  if (__DEMO__) {
    const module = await import('./lib/demo')
    let user = module.DEMO_CHEF
    repository = module.createDemoRepository(() => user)
    demo = {
      chefId: module.DEMO_CHEF,
      customerId: module.DEMO_CUSTOMER,
      setUser: (id) => {
        user = id
      },
      reset: module.resetDemo,
    }
  } else if (supabase) repository = createRepository()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App repository={repository} demo={demo} />
    </StrictMode>,
  )
}
void start()
