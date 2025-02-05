# EMV Alert Bot for BlueSky

EMV (Emergency Management Victoria) provide a data feed that is used in the emergency.vic.gov.au site and app.  This bot reads the feed and sends posts to BlueSky.

It is a quick-and-dirty implementation and has a lot that needs to be done to make it nicer.  Some of the things that would be nice:

* Split long alerts into multiple posts
* Add web card for the links
* Error handling!


## Alert details

Alerts come in a geojson file that has two distinct entry types:

1. Warnings
2. Incidents

### Warnings

These are the warnings that include a full polygon along with a web card and text, and a heap of other information.

### Incidents

There are a number of incident sources, and each provides slightly different information.

* ESTA - Emergency Services Telecommunications Authority, now known as Triple Zero Victoria.  They handle calls for all emergency services.
* CFA - Country Fire Authority - Responsible for fire fighting in private land in rural and regional Victoria - Volunteer organisation
* FRV - Fire Rescue Victora (used to be MFB - Metropolitan Fire Brigade) - Handles fires and rescue in metro and major regional hubs
* FFMV - Forest Fire Management Victoria - a subsection of DEECA (formerly DEWLP, DSE, and various other designations)
* SES - State Emergency Services - responsible for general emergency response (rescue, storm damage, flood, etc). Volunteer organisation

Notibly absent in the feed, for obvious reasons, are VicPol (Victoria Police) and AV (Ambulance Victoria).

Incidents have a lifecycle that depends on the source.  Generally the fire services have the same cycle, and SES a slightly different one.

Fire services will open a job from a variety of sources, these are listed in the "via" section of the "From" line.  Examples are "000" - the emergency phone number, "RADIO" - meaning a fire call lodged by an active unit - usually a fire spotter aircraft, and others that indicate from a services own internal system.

Fires start off as an open job, which will usually show up as "Responding" as the first status.  This may transit through "Not Yet Under Control", "Controlled", to finally "Safe"

Fire incidents have a sub-category (listed as the last hashtag) that indicates the type of incident.  For CFA at least these can be:

* Bushfire
* Grass and Scrub Fire
* Non Structure Fire
* Structure Fire
* Other Fire
* Incident
* Rescue

The feed generally calls Structure Fires "Building Fire", and conflates both Bushfire and Grass and Scrub Fire as "Bushfire".

SES jobs start off as "Request for Assistance", and transfer through "Responding" to "Complete"/

Because the "Responding" status can get updated multiple times (for all services) as more resources are added, only the first status of any kind is reported.
