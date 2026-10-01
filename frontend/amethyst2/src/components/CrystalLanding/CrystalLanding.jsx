import { useEffect, useState } from 'react'
import logo from '../../assets/amethyst-logo.png'
import './CrystalLanding.css'
import { pieces } from './crystalGeometry'

const TOTAL = 8


export default function CrystalLanding({ onEnter }) {
  const [hits, setHits] = useState(0)
  const [stage, setStage] = useState('crystal')
  const [impact, setImpact] = useState({ x: 50, y: 50 })
  useEffect(() => {
    if (stage !== 'breaking') return
    const timer = window.setTimeout(onEnter, 1100)
    return () => window.clearTimeout(timer)
  }, [stage, onEnter])
  function strike(event) {
    if (stage !== 'crystal') return
    const bounds = event.currentTarget.getBoundingClientRect()
    setImpact(event.detail === 0 ? { x: 50, y: 50 } : { x: (event.clientX - bounds.left) / bounds.width * 100, y: (event.clientY - bounds.top) / bounds.height * 100 })
    setHits(hits + 1)
    if (hits + 1 === TOTAL) setStage('breaking')
  }

  return (
    <main className="entry-page">
      <header className="entry-brand"><span className="brand-gem" aria-hidden="true">◇</span> AMETHYST PLUS <span className="brand-caption">SCHEDULING HUB</span></header>
      <section className={`crystal-entry ${stage === 'breaking' ? 'is-breaking' : ''}`} aria-label="Enter Amethyst Plus">
        <p className="eyebrow">A LITTLE DISCOVERY BEFORE YOUR DAY</p>
        <h1>Break into something brilliant.</h1>
        <p className="entry-description">Your next chapter is just beneath the surface.</p>
        <button className="crystal-button" onClick={strike} disabled={stage === 'breaking'} aria-label={`Break the crystal. ${TOTAL - hits} hits remaining.`}>
          <svg className="crystal-art" viewBox="0 0 100 100" aria-hidden="true">
            <defs>
              <clipPath id="crystal-outline"><polygon points="50,0 88,18 100,62 86,91 50,100 14,91 0,62 12,18"/></clipPath>
              <linearGradient id="ice" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#e6faff" stopOpacity=".65"/><stop offset=".45" stopColor="#9c7fff" stopOpacity=".08"/><stop offset="1" stopColor="#9dd4ff" stopOpacity=".38"/></linearGradient>
              {pieces.map((piece, index) => <clipPath id={`facet-${index}`} key={index}><polygon points={piece.points}/></clipPath>)}
            </defs>
            {pieces.map((piece, index) => <g key={index} className="crystal-piece" style={{ '--dx': `${(piece.x - 50) * 5}px`, '--dy': `${(piece.y - 50) * 5}px`, '--turn': `${piece.rotation}deg`, '--delay': `${index % 5 * 25}ms`, transformOrigin: `${piece.x}px ${piece.y}px` }}>
              <g clipPath={`url(#facet-${index})`}><g clipPath="url(#crystal-outline)">
                <image href={logo} width="100" height="100" preserveAspectRatio="xMidYMid meet"/>
                <polygon points={piece.points} fill="url(#ice)"/>
                <polygon points={piece.points} fill={index % 3 === 0 ? '#d9d0ff' : '#a4e7ff'} fillOpacity={index % 3 === 0 ? '.15' : '.04'} stroke="#e5e4ff" strokeWidth=".22" strokeOpacity=".5"/>
              </g></g>
            </g>)}
            {stage !== 'breaking' && <g className="crystal-cracks" clipPath="url(#crystal-outline)" fill="none" stroke="#f2ecff" strokeWidth=".38" strokeLinejoin="round">{pieces.slice(0, Math.ceil(hits * pieces.length / TOTAL)).map((piece, index) => <polyline key={index} points={piece.points}/>)}</g>}
          </svg>
          {hits > 0 && stage !== 'breaking' && <span key={hits} className="impact-ring" style={{ left: `${impact.x}%`, top: `${impact.y}%` }}/>}
          <span className="crystal-glint" aria-hidden="true">✦</span>
        </button>
        <div className="crystal-instructions">
          <p className="tap-label" aria-live="polite">{stage === 'breaking' ? 'Welcome inside.' : hits === 0 ? 'Tap the crystal to begin' : `${TOTAL - hits} more ${TOTAL - hits === 1 ? 'tap' : 'taps'} to break through`}</p>
          <div className="hit-progress" aria-hidden="true">{Array.from({ length: TOTAL }, (_, index) => <span key={index} className={index < hits ? 'is-hit' : ''}/>)}</div>
          <button className="text-button" onClick={onEnter}>Skip to sign in ↗</button>
        </div>
      </section>
      <footer className="entry-footer"><span>Clarity. Connection. Possibility.</span><span>AMETHYST PLUS</span></footer>
    </main>
  )
}
