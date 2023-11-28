import * as turf from '@turf/turf'
import chroma from 'chroma-js'
import RBush from 'rbush'


export const calcPartisanAdvantage = (shapefileShapes, precinctShapes, electoralFields, mapping) => {
  const districtResults = {}
  const districtMargins = {}

  const checkedPrecincts = new Set()
  const tree = new RBush()
  const precinctAreas = new Map() // Store pre-calculated areas

  precinctShapes.forEach((precinct, index) => {
    const bbox = turf.bbox(precinct.geometry)
    const area = turf.area(precinct.geometry)
    precinctAreas.set(precinct.properties.NAME, area)

    tree.insert({
      minX: bbox[0],
      minY: bbox[1],
      maxX: bbox[2],
      maxY: bbox[3],
      id: index,
    })
  })

  shapefileShapes.forEach((districtFeature) => {
    const districtId = districtFeature.properties.ID

    // Use the R-tree to find potential intersecting precincts
    const districtBbox = turf.bbox(districtFeature.geometry)
    const candidates = tree.search({
      minX: districtBbox[0],
      minY: districtBbox[1],
      maxX: districtBbox[2],
      maxY: districtBbox[3],
    })

    // Process each potentially intersecting precinct
    candidates.forEach((candidate) => {
      const precinctFeature = precinctShapes[candidate.id]
      const precinctId = precinctFeature.properties.NAME

      if (checkedPrecincts.has(precinctId)) return
      try {
        const intersection = turf.intersect(districtFeature.geometry, precinctFeature.geometry)
        if (intersection) {
          const intersectionArea = turf.area(intersection)
          const precinctArea = precinctAreas.get(precinctId)
          const areaRatio = intersectionArea / precinctArea

          const properties = precinctFeature.properties

          // If the area ratio is 1 (or very close), the precinct is fully within the district
          if (areaRatio >= 0.99) { // using 0.99 to account for minor numerical inaccuracies
            checkedPrecincts.add(precinctId)
          }

          electoralFields.forEach((field) => {
            const electionCode = field.content.substring(mapping[2].start, mapping[2].end)
            const candidateCode = field.content.substring(mapping[4].start, mapping[4].end)
            const partyCode = field.content.substring(mapping[3].start, mapping[3].end) // Extracting party code

            const votes = properties[field.content]
            // const proportionalVotes = Math.round(votes * areaRatio) // Multiply votes by area ratio and round

            if (!districtResults[districtId]) {
              districtResults[districtId] = {}
            }
            if (!districtResults[districtId][electionCode]) {
              districtResults[districtId][electionCode] = {}
            }
            if (!districtResults[districtId][electionCode][partyCode]) {
              districtResults[districtId][electionCode][partyCode] = { totalVotes: 0, candidate: candidateCode }
            }

            districtResults[districtId][electionCode][partyCode].totalVotes += votes
          })
        }
      } catch (error) {
        console.error('Error processing feature:', error)
      }
    })
  })

  Object.keys(districtResults).forEach((districtId) => {
    Object.keys(districtResults[districtId]).forEach((electionCode) => {
      const parties = districtResults[districtId][electionCode]
      const sortedParties = Object.entries(parties).sort((a, b) => b[1].totalVotes - a[1].totalVotes)
      const winningMargin = ((sortedParties[0][1].totalVotes - sortedParties[1][1].totalVotes) / sortedParties[0][1].totalVotes) * 100
      const winningParty = sortedParties[0][0]

      const colorScale = chroma.scale([
        winningParty === 'R' ? '#c37884' : '#3434c0',
        'white',
      ]).domain([15, 0])

      let color
      if (winningMargin > 15) {
        color = winningParty === 'R' ? '#c37884' : '#3434c0'
      } else {
        color = colorScale(winningMargin).hex()
      }

      districtMargins[districtId] = color
    })
  })

  console.log(districtMargins)
  return { districtMargins, districtResults }
}