const express = require('express');
const rp = require('request-promise-native');
const cors = require('cors');
const querystring = require('querystring');
const cookieParser = require('cookie-parser');
const moment = require('moment')
const SpotifyApi = require('./spotify_api');

// spotify client info (client_id, client_secret, and userId)
const spotifyConfig = require('./spotify_config');
const redirect_uri = 'http://localhost:8888/callback'; // Your redirect uri
const stateKey = 'spotify_auth_state';

let spotifyApi;
let previousTerm = {};
let currentPlaylist;
let songCache = new Set();

// configure web app
const app = express();
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
      client_id: spotifyConfig.client_id,
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
    spotifyApi = new SpotifyApi(code);
    spotifyApi.authenticated
      .then(seedCache)
      .then(() => getCurrentSiriusSongAndAddToSpotify(0))
      .catch(logError);
  }
});

const seedCache = () => {
  return spotifyApi.getPlaylists('Sirius')
    .then(
      (playlists) => {
        if (playlists) {
          let promises = [];
          playlists.forEach((playlist) => {
            if (playlist.tracks.total < 100) {
              currentPlaylist = playlist;
              logInfo('Adding to playlist: ' + currentPlaylist)
            }
            promises.push(spotifyApi.getPlaylistTracks(playlist.id).then(
              (playlist) => {
                if (playlist) {
                  playlist.items.forEach(i => songCache.add(i.track.uri));
                }
              }
            ));
          });
          return Promise.all(promises);
        }
        return Promise.reject('Could not find any playlists');
      });
}

const checkAndMaybeCreateNewPlaylist = () => {
  return spotifyApi.getPlaylist(currentPlaylist.id)
    .then(
      (playlist) => {
        if (playlist) {
          currentPlaylist = playlist;
        }
        if (currentPlaylist.tracks.total >= 100) {
          return spotifyApi.createNewPlaylist(currentPlaylist.name);
        }
        return Promise.resolve();
      }
    )
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
  return rp(opts)
    .then(
      (siriusResponse) => {
        if (siriusResponse && siriusResponse.channelMetadataResponse &&
          siriusResponse.channelMetadataResponse.metaData && siriusResponse.channelMetadataResponse.metaData.currentEvent) {
          const event = siriusResponse.channelMetadataResponse.metaData.currentEvent, artist = event.artists.name, album = event.song.album.name, songName = event.song.name
          const searchTerm = {artist: artist, album: album, song: songName};
          if (searchTerm.song !== previousTerm.song) {
            logInfo('Current song is: ' + searchTerm.artist + ' ' + searchTerm.album + ' ' + searchTerm.song);
            previousTerm = searchTerm;
            return Promise.resolve(searchTerm);
          }
          return Promise.reject('Song is the same.');
        }
        return Promise.reject('Unusual response from the Sirius API: ' + JSON.stringify(siriusResponse))
      });
};

const addSong = () => {
  getCurrentSiriusSong()
    .then((searchTerm) => spotifyApi.findSongOnSpotify(searchTerm))
    .then((spotifyTrack) => {
      if (songCache.has(spotifyTrack.uri)) {
        return Promise.reject('Song is a duplicate. Not adding.');
      }
      songCache.add(spotifyTrack.uri);
      return spotifyApi.addSongToPlayList(currentPlaylist.id, spotifyTrack);
    })
    .then(
      (spotifyResponse) => {
        if (spotifyResponse) {
          logInfo('Added song successfully');
          checkAndMaybeCreateNewPlaylist()
            .then(
              (playlist) => {
                if (playlist) {
                  logInfo('Created new playlist ' + playlist.name);
                  currentPlaylist = playlist;
                }
              });
        }
      }
    )
    .catch(logError);
  getCurrentSiriusSongAndAddToSpotify(120 * 1000);
};

const getCurrentSiriusSongAndAddToSpotify = (timeout) => setTimeout(addSong, timeout);

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

const logInfo = (info) => log('INFO', info);

const logError = (info) => log('ERROR', info);

const log = (level, msg) => console.log(level + ': ' + msg);

// start application
logInfo('Listening on 8888');
app.listen(8888);
