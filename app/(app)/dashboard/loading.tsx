import { ParticleZone } from '@ad/ui'

// Grideet is loading (server render): the logo formation, as in the app's other loading states.
export default function GrideetLoading() {
  return (
    <div className="q-page-wrap" role="status" aria-label="Loading the dashboard">
      <ParticleZone className="q-load-pz" shapes={['@logo', 'GRID']} />
    </div>
  )
}
