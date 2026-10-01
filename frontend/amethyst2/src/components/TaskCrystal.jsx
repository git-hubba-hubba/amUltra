import { useId } from 'react';
import { pieces } from './CrystalLanding/crystalGeometry';
import './TaskCrystal.css';

export default function TaskCrystal() {
  const gradient = useId();
  return <div className="task-crystal" aria-hidden="true">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#e6faff" stopOpacity=".65"/>
          <stop offset=".45" stopColor="#9c7fff" stopOpacity=".08"/>
          <stop offset="1" stopColor="#9dd4ff" stopOpacity=".38"/>
        </linearGradient>
      </defs>
      {pieces.map((piece, index) => <g key={index} className="task-crystal-facet" style={{
        '--dx': `${(piece.x - 50) * 2}px`, '--dy': `${(piece.y - 50) * 2}px`,
        '--turn': `${piece.rotation}deg`, '--delay': `${index % 5 * 25}ms`,
        transformOrigin: `${piece.x}px ${piece.y}px`,
      }}>
        <polygon points={piece.points} fill={`url(#${gradient})`}/>
        <polygon points={piece.points} fill={index % 3 === 0 ? '#d9d0ff' : '#a4e7ff'} fillOpacity={index % 3 === 0 ? '.15' : '.04'} stroke="#e5e4ff" strokeWidth=".65" strokeOpacity=".65" vectorEffect="non-scaling-stroke"/>
      </g>)}
    </svg>
    <span className="task-crystal-glint">✦</span>
    <span className="task-crystal-glint task-crystal-glint-secondary">✦</span>
    <span className="task-crystal-impact"/>
  </div>;
}
