/*
 * We pull the update info stub regularly, and only process the main geojson when
 * there is an update. We then pull any and all warnings that have been updated
 * since the last pass and send them to BlueSky
*/
import { BskyAgent, RichText } from '@atproto/api'
import * as dotenv from 'dotenv'
import { DateTime } from 'luxon'

dotenv.config()

const agent = new BskyAgent({
  service: 'https://bsky.social'
})

const incidentMap = {}

const control = {
  lastProcessed: false
}

async function updated () {
  const response = await fetch(process.env.DELTA_URL)
  if (!response.ok) {
    throw new Error(`response status ${response.status}`)
  }
  const lastUpdate = await response.json()
  control.lastModified = DateTime.fromISO(lastUpdate.lastModified)
  if (!control.lastProcessed) {
    control.lastProcessed = DateTime.now()
  }
  console.log(control)
  return control.lastModified.toMillis() > control.lastProcessed.toMillis()
}

async function postUpdates (incidents) {
  await agent.login({ identifier: process.env.BLUESKY_USERNAME, password: process.env.BLUESKY_PASSWORD })
  for (const incident of incidents) {
    if (incident) {
      console.log(incident)
      const rt = new RichText({ text: incident })
      await rt.detectFacets(agent)
      const post = {
        $type: 'app.bsky.feed.post',
        text: rt.text,
        facets: rt.facets,
        createdAt: DateTime.now().toISO()
      }
      await agent.post(post)
    }
  }
}

// Format a post for the particular incident type
// Incidents have a single Point, sourceTitle, status, location, sizeFmt, category2 indicates type of incident, category1 indicates the icon to use.
// Warnings have an incidentFeature element with the associated incident.  Otherwise they have:
// sourceTitle, name, action, location, text
function makePost (incident) {
  let text = ''
  const properties = incident.properties
  let location = []
  if (incident.geometry.type === 'Point') {
    location = incident.geometry.coordinates
  } else if (incident.geometry.type === 'GeometryCollection') {
    location = incident.geometry.geometries.filter(el => el.type === 'Point')[0].coordinates
  }
  let locname = properties.location

  switch (properties.feedType) {
    case 'incident':
      text = `${properties.category2} ${properties.location}\n\nStatus: ${properties.status}\nSize: ${properties.sizeFmt || 'unknown'}\nResources: ${properties.resources}\nUpdated: ${properties.updated}\nFrom #${properties.sourceOrg} via ${properties.source}\n`
      if (location.length) {
        text += `https://www.google.com/maps/search/?api=1&query=${location[1]},${location[0]}\n`
      }
      text += `#EMVAlert #${properties.feedType} #${properties.category1.replaceAll(' ', '')} #${properties.category2.replaceAll(' ', '')}`
      break
    case 'warning':
      if (properties.location.length > 100) {
        locname = properties.location.substr(0, 100) + '...'
      }
      text = `${properties.name}\n${properties.action}\n${locname}\nUpdated ${properties.updated}\nMore information: http://emergency.vic.gov.au/respond/#!/warning/${properties.sourceId}/moreinfo\nFrom #${properties.sourceOrg}\n#EMVAlert #${properties.feedType}`
      break
    default:
      console.log(`unknown feed type ${properties.feedType}`)
      break
  }
  return text
}

async function main () {
  const data = await fetch(process.env.DATA_URL)
  if (!data.ok) {
    return
  }
  const posts = []
  console.log('processing')
  const incidents = await data.json()
  let updateCount = 0
  for (const feature of incidents.features) {
    const updateTime = DateTime.fromISO(feature.properties.updated)
    if (updateTime.toMillis() > control.lastProcessed.toMillis()) {
      console.log(`${feature.properties.feedType} ${feature.properties.category1} ${feature.properties.category2} ${feature.properties.location}`)
      if (!Object.prototype.hasOwnProperty.call(incidentMap, feature.properties.id) || (feature.properties.status && incidentMap[feature.properties.id].status !== feature.properties.status)) {
        incidentMap[feature.properties.id] = feature.properties
        posts.push(makePost(feature))
        updateCount++
      }
    }
  }
  if (updateCount) {
    await postUpdates(posts)
    control.lastProcessed = DateTime.now()
  }
}

// First up, read in the last updated, and set up our control structure
await updated()

// Now we constantly poll the

function loop () {
  setTimeout(async () => {
    await main()
    loop()
  }, 30000)
}

loop()
