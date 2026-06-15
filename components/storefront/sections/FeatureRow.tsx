import type { FeatureRowProps } from '@/types/manifest'
import { Reveal } from '../motion/Reveal'
import { Stagger, StaggerItem } from '../motion/Stagger'
import {
  Leaf,
  FlaskConical,
  Recycle,
  Star,
  Zap,
  Shield,
  Check,
  Package,
  Truck,
  Heart,
  Globe,
  Sparkles,
  Award,
  Clock,
  Lock,
  Mail,
  type LucideProps,
} from 'lucide-react'

type IconComponent = React.ComponentType<LucideProps>

const ICON_MAP: Record<string, IconComponent> = {
  leaf: Leaf,
  flask: FlaskConical,
  recycle: Recycle,
  star: Star,
  zap: Zap,
  shield: Shield,
  check: Check,
  package: Package,
  truck: Truck,
  heart: Heart,
  globe: Globe,
  sparkles: Sparkles,
  award: Award,
  clock: Clock,
  lock: Lock,
  mail: Mail,
}

function getIcon(name?: string): IconComponent | null {
  if (!name) return null
  return ICON_MAP[name.toLowerCase()] ?? null
}

interface Props {
  props: FeatureRowProps
}

export function FeatureRow({ props }: Props) {
  const { title, features, layout } = props

  return (
    <section
      style={{
        background: 'var(--s-surface)',
        padding: `calc(5rem * var(--s-space)) 2rem`,
      }}
    >
      <div style={{ maxWidth: '64rem', margin: '0 auto' }}>
        {title && (
          <Reveal variant="fade-up">
            <h2
              style={{
                fontFamily: 'var(--s-font-heading)',
                fontSize: 'clamp(1.5rem, 3vw, 2rem)',
                fontWeight: 700,
                color: 'var(--s-text)',
                textAlign: 'center',
                marginBottom: `calc(3rem * var(--s-space))`,
                letterSpacing: '-0.02em',
              }}
            >
              {title}
            </h2>
          </Reveal>
        )}
        <Stagger
          style={{
            display: layout === 'grid' ? 'grid' : 'flex',
            gridTemplateColumns: layout === 'grid' ? 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))' : undefined,
            flexDirection: layout === 'list' ? 'column' : undefined,
            gap: `calc(2rem * var(--s-space))`,
          }}
        >
          {features.map((feature, i) => {
            const Icon = getIcon(feature.icon)
            return (
              <StaggerItem
                key={i}
                style={{
                  display: 'flex',
                  flexDirection: layout === 'list' ? 'row' : 'column',
                  gap: layout === 'list' ? '1.25rem' : '1rem',
                  alignItems: layout === 'list' ? 'flex-start' : undefined,
                }}
              >
                {Icon && (
                  <div
                    style={{
                      width: '2.5rem',
                      height: '2.5rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'var(--s-bg)',
                      borderRadius: 'var(--s-radius)',
                      border: '1px solid var(--s-border)',
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={18} color="var(--s-accent)" />
                  </div>
                )}
                <div>
                  <p
                    style={{
                      fontWeight: 600,
                      color: 'var(--s-text)',
                      fontSize: '0.9375rem',
                      marginBottom: '0.375rem',
                      fontFamily: 'var(--s-font-body)',
                    }}
                  >
                    {feature.title}
                  </p>
                  <p
                    style={{
                      color: 'var(--s-muted)',
                      fontSize: '0.875rem',
                      lineHeight: 1.7,
                      fontFamily: 'var(--s-font-body)',
                    }}
                  >
                    {feature.description}
                  </p>
                </div>
              </StaggerItem>
            )
          })}
        </Stagger>
      </div>
    </section>
  )
}
