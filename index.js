/*
 * We pull the update info stub regularly, and only process the main geojson when
 * there is an update. We then pull any and all warnings that have been updated
 * since the last pass and send them to BlueSky
*/
import { BskyAgent } from '@atproto/api'
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
    control.lastModified = DateTime.now()
  } else {
    const lastUpdate = await response.json()
    control.lastModified = DateTime.fromISO(lastUpdate.lastModified)
  }
  if (!control.lastProcessed) {
    control.lastProcessed = DateTime.now()
  }
  console.log(control)
  return control.lastModified.toMillis() > control.lastProcessed.toMillis()
}

async function postUpdates (incidents) {
  await agent.login({ identifier: process.env.BLUESKY_USERNAME, password: process.env.BLUESKY_PASSWORD })
  for (const incident of incidents) {
    if (incident.text) {
      console.log(incident.text)
      await agent.post(incident)
    }
  }
}

// Format a post for the particular incident type
// Incidents have a single Point, sourceTitle, status, location, sizeFmt, category2 indicates type of incident, category1 indicates the icon to use.
// Warnings have an incidentFeature element with the associated incident.  Otherwise they have:
// sourceTitle, name, action, location, text
function makePost (incident) {
  const post = {
    $type: 'app.bsky.feed.post',
    text: '',
    facets: [],
    createdAt: DateTime.now().toISO()
  }
  const properties = incident.properties
  let location = []
  if (incident.geometry.type === 'Point') {
    location = incident.geometry.coordinates
  } else if (incident.geometry.type === 'GeometryCollection') {
    location = incident.geometry.geometries.filter(el => el.type === 'Point')[0].coordinates
  }
  let locname = properties.location

  const updated = DateTime.fromISO(properties.updated).setZone('Australia/Melbourne').toLocaleString(DateTime.DATETIME_MED)
  const mapLink = 'Find on Map >'
  const detailLink = 'Full Details >'

  switch (properties.feedType) {
    case 'incident':
      post.text = `${properties.category2} ${properties.location}\n\nStatus: ${properties.status}`
      if (Object.prototype.hasOwnProperty.call(properties, 'sizeFmt')) {
        if (Array.isArray(properties.sizeFmt)) {
          post.text += `\nSize: ${properties.sizeFmt[0]}`
        } else {
          post.text += `\nSize: ${properties.sizeFmt}`
        }
      }
      post.text += `\nResources: ${properties.resources}\n${updated}\nFrom #${properties.sourceOrg}`
      if (Object.prototype.hasOwnProperty.call(properties, 'source') && !properties.source.startsWith('ERROR')) {
        post.text += ` via ${properties.source}`
      }
      post.text += '\n'
      if (location.length) {
        post.facets.push({
          index: {
            byteStart: post.text.length,
            byteEnd: post.text.length + mapLink.length
          },
          features: [{
            $type: 'app.bsky.richtext.facet#link',
            uri: `https://www.google.com/maps/search/?api=1&query=${location[1]},${location[0]}`
          }]
        })
        post.text += mapLink
      }
      break
    case 'warning':
      if (properties.location.length > 160) {
        locname = properties.location.substr(0, 160) + '...'
      }
      post.text = `${properties.name}\n${properties.action}\n${locname}\n${updated}\n`
      post.facets.push({
        index: {
          byteStart: post.text.length,
          byteEnd: post.text.length + detailLink.length
        },
        features: [{
          $type: 'app.bsky.richtext.facet#link',
          uri: `http://emergency.vic.gov.au/respond/#!/warning/${properties.sourceId}/moreinfo`
        }]
      })
      post.text += `${detailLink}\nFrom #${properties.sourceOrg}`
      break
    default:
      console.log(`unknown feed type ${properties.feedType}`)
      break
  }

  function addTag (tagName) {
    post.facets.push({
      index: {
        byteStart: post.text.length,
        byteEnd: post.text.length + tagName.length + 1
      },
      features: [{
        $type: 'app.bsky.richtext.facet#tag',
        tag: tagName
      }]
    })
    post.text += `#${tagName}`
  }

  if (post.text) {
    post.text += '\n'
    addTag('EMVAlert')
    post.text += ' '
    addTag(properties.feedType)
    post.text += ' '
    addTag(properties.category1.replaceAll(' ', ''))
    if (properties.category2 !== properties.category1) {
      post.text += ' '
      addTag(properties.category2.replaceAll(' ', ''))
    }
  }

  return post
}

async function main () {
  try {
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
  } catch (err) {
    return err
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
