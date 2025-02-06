/*
 * We pull the update info stub regularly, and only process the main geojson when
 * there is an update. We then pull any and all warnings that have been updated
 * since the last pass and send them to BlueSky
*/
import { BskyAgent } from '@atproto/api'
import * as dotenv from 'dotenv'
import { DateTime } from 'luxon'

dotenv.config()

const VERBOSE = (process.env.DEBUG || 'N') === 'Y'

const agent = new BskyAgent({
  service: 'https://bsky.social'
})

const incidentMap = {}

const control = {
  lastProcessed: false
}

function debug (msg) {
  if (VERBOSE) {
    console.log(msg)
  }
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
  debug(control)
  return control.lastModified.toMillis() > control.lastProcessed.toMillis()
}

async function postUpdates (incidents) {
  await agent.login({ identifier: process.env.BLUESKY_USERNAME, password: process.env.BLUESKY_PASSWORD })
  for (const incident of incidents) {
    if (incident.text) {
      debug(incident.text)
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

  function timeSinceStart () {
    const secsSinceStart = (DateTime.fromISO(properties.updated).toMillis() - DateTime.fromISO(properties.created).toMillis()) / 1000
    const days = Math.floor(secsSinceStart / 86400)
    const hours = Math.floor((secsSinceStart % 86400) / 3600)
    const mins = Math.floor((secsSinceStart % 3600) / 60)
    const secs = Math.floor(secsSinceStart % 60)

    let timeStamp = ''
    if (days) {
      timeStamp += `${days}d `
    }
    if (hours) {
      timeStamp += `${hours}h `
    }
    if (mins) {
      timeStamp += `${mins}m `
    }
    if (secs) {
      timeStamp += `${secs}s`
    }
    return timeStamp
  }

  const updated = DateTime.fromISO(properties.updated).setZone('Australia/Melbourne').toLocaleString(DateTime.DATETIME_MED)
  const mapLink = 'Find on Map >'
  const detailLink = 'Full Details >'
  const openTime = timeSinceStart()

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
      if (Object.prototype.hasOwnProperty.call(properties, 'resources')) {
        post.text += `\nResources: ${properties.resources}`
      }
      post.text += `\n${updated}`
      if (openTime.length) {
        post.text += ` - open ${openTime}`
      }
      post.text += '\nFrom '
      addTag(properties.sourceOrg)
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
      post.text += `${detailLink}\nFrom `
      addTag(properties.sourceOrg)
      break
    default:
      console.log(`unknown feed type ${properties.feedType}`)
      break
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

function cleanupOldIncidents () {
  const millisOld = Number(process.env.PURGE_DAYS || 4) * 86400 * 1000
  const delKeys = []
  const now = DateTime.now().toMillis()
  const cutoff = now - millisOld
  for (const [ix, val] of Object.entries(incidentMap)) {
    if (DateTime.fromISO(val.updated).toMillis() < cutoff) {
      delKeys.push(ix)
    }
  }
  for (const ix of delKeys) {
    delete incidentMap[ix]
  }
}

async function main () {
  try {
    const data = await fetch(process.env.DATA_URL)
    if (!data.ok) {
      console.log('failed to pull data')
      return
    }
    const posts = []
    debug('processing')
    const incidents = await data.json()
    let updateCount = 0
    for (const feature of incidents.features) {
      const updateTime = DateTime.fromISO(feature.properties.updated)
      if (updateTime.toMillis() > control.lastProcessed.toMillis()) {
        debug(`${feature.properties.feedType} ${feature.properties.category1} ${feature.properties.category2} ${feature.properties.location}`)
        if (!Object.prototype.hasOwnProperty.call(incidentMap, feature.properties.id) || (feature.properties.status && incidentMap[feature.properties.id].status !== feature.properties.status)) {
          incidentMap[feature.properties.id] = feature.properties
          posts.push(makePost(feature))
          updateCount++
        }
      }
    }
    if (updateCount) {
      if (process.env.POST_TO_BSKY === 'Y') {
        await postUpdates(posts)
      } else {
        for (const post of posts) {
          debug(post.text)
        }
      }
      cleanupOldIncidents()
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
  }, Number(process.env.UPDATE_TIME) * 1000)
}

loop()
