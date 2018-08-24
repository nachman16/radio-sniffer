const express = require('express');
const rp = require('request-promise-native');
const cors = require('cors');
const querystring = require('querystring');
const cookieParser = require('cookie-parser');
const moment = require('moment')

// spotify client info
const client_id = ''; // Your client id
const client_secret = ''; // Your secret
const redirect_uri = 'http://localhost:8888/callback'; // Your redirect uri
const stateKey = 'spotify_auth_state';

const app = express();

let access_token;
let refresh_token;
let previousTerm = {};


app.use(express.static(__dirname + '/public'))
  .use(cors())
  .use(cookieParser());

app.get('/login', (req, res) => {
  const state = generateRandomString(16);
  res.cookie(stateKey, state);

  // your application requests authorization
  const scope = 'playlist-modify-private playlist-modify-public';
  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: client_id,
      scope: scope,
      redirect_uri: redirect_uri,
      state: state
    })
  );
});

app.get('/callback', (req, res) => {
  const code = req.query.code || null;
  const state = req.query.state || null;
  const storedState = req.cookies ? req.cookies[stateKey] : null;

  if (state === null || state !== storedState) {
    res.redirect('/#' +
      querystring.stringify({
        error: 'state_mismatch'
      }));
  } else {
    res.clearCookie(stateKey);
    const authOptions = {
      method: 'POST',
      url: 'https://accounts.spotify.com/api/token',
      form: {
        code: code,
        redirect_uri: redirect_uri,
        grant_type: 'authorization_code'
      },
      headers: {
        'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64'))
      },
      json: true
    };
    rp(authOptions)
      .then(
        (body) => {
          console.log("Authenticated successfully");
          access_token = body.access_token;
          refresh_token = body.refresh_token;
          getCurrentSiriusSongAndAddToSpotify(0);
        },
        (error) => console.log("ERROR: Could not authenticate, " + error)
      );
  }
});

function findSongOnSpotify(query) {
  const options = {
    uri: 'https://api.spotify.com/v1/search?type=track&q=' + encodeURIComponent(query),
    headers: {
      'Authorization': 'Bearer ' + access_token
    },
    json: true
  };
  console.log("INFO: Calling " + options.uri)
  return rp(options);
}

function addSongToPlayList(spotifyTrack) {
  const playlistid = ''
  const options = {
    method: 'POST',
    uri: 'https://api.spotify.com/v1/playlists/' + playlistid + '/tracks?uris=' + spotifyTrack.uri,
    headers: {
      'Authorization': 'Bearer ' + access_token
    },
    json: true
  };
  console.log("INFO: Calling " + options.uri)
  return rp(options);
}

const getCurrentSiriusSong = () => {
  const timestamp = moment().add(4, 'hours').format('MM-DD-HH:mm:00');
  const url = 'https://www.siriusxm.com/metadata/pdt/en-us/json/channels/purejazz/timestamp/' + timestamp;
  const opts = {
    uri: url,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    },
    json: true
  };

  // sirius part
  return rp(opts);
};

const addSong = () => {
  getCurrentSiriusSong()
    .then(
      (body) => {
        if (body && body.channelMetadataResponse && body.channelMetadataResponse.metaData && body.channelMetadataResponse.metaData.currentEvent) {
          const event = body.channelMetadataResponse.metaData.currentEvent, artist = event.artists.name, album = event.song.album.name, songName = event.song.name
          const searchTerm = {artist: artist, album: album, song: songName};
          if (searchTerm.song !== previousTerm.song) {
            console.log("INFO: Current song is: " + searchTerm.artist + " " + searchTerm.album + " " + searchTerm.song);
            previousTerm = searchTerm;
            return findSongOnSpotify(searchTerm.artist + " " + searchTerm.album + " " + searchTerm.song);
          }
          return Promise.reject("Song is the same.");
        }
      },
      (error) => console.log("ERROR: tried getting current song on sirius and failed, " + error)
    )
    .then(
      (body) => {
        const firstResult = body.tracks && body.tracks.items ? body.tracks.items[0] : null;
        if (firstResult) {
          return addSongToPlayList(firstResult);
        } else {
          console.log("Couldn't find the song. Trying without an album: " + previousTerm.artist + " " + previousTerm.song);
          return findSongOnSpotify(previousTerm.artist + " " + previousTerm.song)
            .then((body) => {
              const firstResult = body.tracks && body.tracks.items ? body.tracks.items[0] : null;
              if (firstResult) {
                return addSongToPlayList(firstResult);
              }
            });
        }
      },
      (error) => console.log("ERROR: tried finding song on Spotify and failed, " + error)
    )
    .then(
      (body) => {
        if (body) {
          console.log("INFO: added song successfully");
        }
        getCurrentSiriusSongAndAddToSpotify(120 * 1000);
      },
      (error) => console.log("ERROR: tried adding song to playlist on Spotify and failed, " + error)
    );
};

const getCurrentSiriusSongAndAddToSpotify = (timeout) => setTimeout(addSong, timeout);

const refreshSpotifyToken = () => setTimeout(refreshToken, 1000 * 60 * 30);

const refreshToken = () => {
  const authOptions = {
    method: 'POST',
    url: 'https://accounts.spotify.com/api/token',
    form: {
      refresh_token: refresh_token,
      grant_type: 'refresh_token'
    },
    headers: {
      'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64'))
    },
    json: true
  };

  rp(authOptions)
    .then(
      (body) => {
        console.log("INFO: Call to refresh access token succeeded");
        access_token = body.access_token;
        refresh_token = body.refresh_token;
      },
      (error) => console.log("ERROR: tried fetching new access token and failed, " + error)
    );
  refreshSpotifyToken();
}

/**
 * Generates a random string containing numbers and letters
 * @param  {number} length The length of the string
 * @return {string} The generated string
 */
const generateRandomString = (length) => {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};


// start application
setTimeout(refreshSpotifyToken, 1000 * 60 * 30);
console.log('INFO: Listening on 8888');
app.listen(8888);