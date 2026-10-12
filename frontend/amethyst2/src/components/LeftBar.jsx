import membersIcon from '../assets/icons/members.png'
import overviewIcon from '../assets/icons/overview.svg'
import meetingsIcon from '../assets/icons/meetings.jpg'
import projectsIcon from '../assets/icons/projects.svg'
import conceptIcon from '../assets/icons/concept.png'
import roadmapIcon from '../assets/icons/roadmap.png'
import SideTab from './SideTab'

function LeftBar({currentDisplay, setCurrentDisplay}) {
  const sidetabs = [
    { title: 'Jade', currentDisplayName: 'jade', symbol: 'jade' },
    {
      title: 'Members',
      img: membersIcon,
      currentDisplayName: 'members'
    },
    {
      title: "Overview",
      img: overviewIcon,
      currentDisplayName:'overview'
    },
    {
      title: "Meetings",
      img: meetingsIcon,
      currentDisplayName:'meetings'
    },
    {
      title: "Projects",
      img: projectsIcon,
      currentDisplayName:'projects'
    },
    {
      title: "Concept",
      img: conceptIcon,
      currentDisplayName:'concept'
    },
    {
      title: "Roadmap",
      img: roadmapIcon,
      currentDisplayName:'roadmap'
    }
  ]
  return (
    <>
      <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
        <defs>
          <filter id="sidebar-blue-white" colorInterpolationFilters="sRGB">
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncR type="table" tableValues="0.157 1" />
              <feFuncG type="table" tableValues="0.408 1" />
              <feFuncB type="table" tableValues="0.533 1" />
            </feComponentTransfer>
          </filter>
        </defs>
      </svg>
      {sidetabs.map((tab,index)=>{
        return(
          <div key={index}>
            <SideTab currObj={tab} currentDisplay={currentDisplay} setCurrentDisplay={setCurrentDisplay} 
            />

          </div>
        )
      })}

    
    
    
    
    
    </>
  )
}

export default LeftBar
