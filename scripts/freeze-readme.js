const fs = require('fs');
const https = require('https');
const readme_file = __dirname + '/../README.md'
let README = fs.readFileSync(readme_file, {encoding:'utf-8'})
let FROZEN_SECTION = /\<\!--\s*BEGIN\s*FROZEN\s*IMAGE\s*(https:\/\/\S*?)(?:\s*as\s*(\S*?))?\s*-->.*?\<!--\s*END\s*FROZEN\s*IMAGE\s*--\>/igs
fs.writeFileSync(readme_file, README.replace(FROZEN_SECTION, downloadAndUpdate))
function downloadAndUpdate(body, url, alias){
  if(!alias){
    alias = url.split('?')[0].split('/').pop()
  }
  https.get(url, 
  {
    "headers": {
      "cache-control": "no-cache",
      "pragma": "no-cache"
    },
  }, (response, error) => {
  if(error){
    console.log(`Failed to download ${url}`)
  }else{
    const file = fs.createWriteStream(`${__dirname}/../static/${alias}`);
    file.on('finish', () => {
      console.log(`Saved file ${alias}`)
    })
    response.pipe(file);
  }
});
 return `<!-- BEGIN FROZEN IMAGE ${url} as ${alias} -->
  <img src="./static/${alias}">
<!-- END FROZEN IMAGE -->`
}