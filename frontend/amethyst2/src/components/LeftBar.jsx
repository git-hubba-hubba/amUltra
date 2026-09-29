import SideTab from './SideTab'

function LeftBar({currentDisplay, setCurrentDisplay}) {
  const sidetabs = [
    {
      title: 'Members',
      img: 'https://cdn-icons-png.flaticon.com/512/1361/1361913.png',
      currentDisplayName: 'members'
    },
    {
      title: "Overview",
      img: "https://png.pngtree.com/png-vector/20190929/ourmid/pngtree-presentation-icon-isolated-on-abstract-background-png-image_1752479.jpg",
      currentDisplayName:'overview'
    },
    {
      title: "Meetings",
      img: "https://img.magnific.com/premium-vector/flat-meeting-icon-transparent-png-vector-layer-illustration_1226483-2779.jpg",
      currentDisplayName:'meetings'
    },
    {
      title: "Projects",
      img: "https://png.pngtree.com/png-vector/20190721/ourmid/pngtree-checklist-icon-for-your-project-png-image_1560043.jpg",
      currentDisplayName:'projects'
    },
    {
      title: "Concept",
      img: "https://static.vecteezy.com/system/resources/thumbnails/043/364/386/small_2x/transparent-black-and-white-brain-logo-icon-minimalist-neural-symbol-free-png.png",
      currentDisplayName:'concept'
    },
    {
      title: "Roadmap",
      img: "https://cdn-icons-png.magnific.com/256/15545/15545015.png?semt=ais_white_label",
      currentDisplayName:'roadmap'
    }
  ]
  return (
    <>
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