const express = require('express');
const rp = require('request-promise-native');
const cors = require('cors');
const querystring = require('querystring');
const cookieParser = require('cookie-parser');
const moment = require('moment')

// spotify client info (client_id, client_secret, and playlistid)
const spotifyConfig = require('./spotify_config');
const redirect_uri = 'http://localhost:8888/callback'; // Your redirect uri
const stateKey = 'spotify_auth_state';

let access_token;
let refresh_token;
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
    authenticateOnSpotify(code)
      .then(seedCache, logError)
      .then(() => getCurrentSiriusSongAndAddToSpotify(0), logError);
  }
});

const seedCache = () => {
  return getPlaylists('Sirius')
    .then(
      (playlists) => {
        if (playlists) {
          let promises = [];
          playlists.forEach((playlist) => {
            if (playlist.tracks.total < 100) {
              currentPlaylist = playlist;
            }
            promises.push(getPlaylistTracks(playlist.id).then(
              (playlist) => {
                if (playlist) {
                  playlist.items.forEach(i => songCache.add(i.track.uri));
                }
              },
              logError
            ));
          });
          return Promise.all(promises);
        }
      }, logError);
}

const authenticateOnSpotify = (code) => {
  const authOptions = {
    method: 'POST',
    url: 'https://accounts.spotify.com/api/token',
    form: {
      code: code,
      redirect_uri: redirect_uri,
      grant_type: 'authorization_code'
    },
    headers: {
      'Authorization': 'Basic ' + (new Buffer(spotifyConfig.client_id + ':' + spotifyConfig.client_secret).toString('base64'))
    },
    json: true
  };
  return rp(authOptions)
    .then(
      (authenticationInfo) => {
        logInfo('Authenticated successfully');
        access_token = authenticationInfo.access_token;
        refresh_token = authenticationInfo.refresh_token;
      }, logError);
};

// spotify methods
const findSongOnSpotify = (query) => {
  const options = {
    uri: 'https://api.spotify.com/v1/search?type=track&q=' + encodeURIComponent(query),
    headers: {
      'Authorization': 'Bearer ' + access_token
    },
    json: true
  };
  logInfo('Calling ' + options.uri)
  return rp(options);
}

const getPlaylistTracks = (playlistId) => {
  const options = {
    uri: 'https://api.spotify.com/v1/playlists/' + playlistId + '/tracks',
    headers: {
      'Authorization': 'Bearer ' + access_token
    },
    json: true
  };
  logInfo('Calling ' + options.uri)
  return rp(options);
}

const getPlaylist = (playlistId) => {
  const options = {
    uri: 'https://api.spotify.com/v1/playlists/' + playlistId,
    headers: {
      'Authorization': 'Bearer ' + access_token
    },
    json: true
  };
  logInfo('Calling ' + options.uri)
  return rp(options);
}

const getPlaylists = (suffix) => {
  const options = {
    uri: 'https://api.spotify.com/v1/me/playlists',
    headers: {
      'Authorization': 'Bearer ' + access_token
    },
    json: true
  };
  logInfo('Calling ' + options.uri)
  return rp(options)
    .then(
      (playlistCollection) => {
        if (playlistCollection && playlistCollection.items) {
          return playlistCollection.items.filter((playlist) => playlist.name.startsWith(suffix));
        }
      },
      logError
    );
};

const createNewPlaylist = () => {
  const options = {
    method: 'POST',
    uri: 'https://api.spotify.com/v1/users/' + spotifyConfig.userId + '/playlists',
    headers: {
      'Authorization': 'Bearer ' + access_token
    },
    body: {
      name: 'Sirius Real Jazz ' + (parseInt(currentPlaylist.name.split(' ').pop()) + 1)
    },
    json: true
  };
  logInfo('Calling ' + options.uri)
  return rp(options);
}

const checkAndMaybeCreateNewPlaylist = () => {
  return getPlaylist(currentPlaylist.id)
    .then(
      (playlist) => {
        if (playlist) {
          currentPlaylist = playlist;
        }
        if (currentPlaylist.tracks.total >= 100) {
          return createNewPlaylist();
        }
        return Promise.resolve();
      }
    )
}

const addSongToPlayList = (spotifyTrack) => {
  if (songCache.has(spotifyTrack.uri)) {
    return Promise.reject('Song is a duplicate. Not adding.');
  }

  songCache.add(spotifyTrack.uri);

  const options = {
    method: 'POST',
    uri: 'https://api.spotify.com/v1/playlists/' + currentPlaylist.id + '/tracks?uris=' + spotifyTrack.uri,
    headers: {
      'Authorization': 'Bearer ' + access_token
    },
    json: true
  };
  logInfo('Calling ' + options.uri)
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
  return rp(opts);
};

const addSong = () => {
  getCurrentSiriusSong()
    .then(
      (siriusResponse) => {
        if (siriusResponse && siriusResponse.channelMetadataResponse &&
          siriusResponse.channelMetadataResponse.metaData && siriusResponse.channelMetadataResponse.metaData.currentEvent) {
          const event = siriusResponse.channelMetadataResponse.metaData.currentEvent, artist = event.artists.name, album = event.song.album.name, songName = event.song.name
          const searchTerm = {artist: artist, album: album, song: songName};
          if (searchTerm.song !== previousTerm.song) {
            logInfo('Current song is: ' + searchTerm.artist + ' ' + searchTerm.album + ' ' + searchTerm.song);
            previousTerm = searchTerm;
            return findSongOnSpotify(searchTerm.artist + ' ' + searchTerm.album + ' ' + searchTerm.song);
          }
          return Promise.reject('Song is the same.');
        }
      },
      logError
    )
    .then(
      (spotifyResult) => {
        const firstResult = spotifyResult && spotifyResult.tracks && spotifyResult.tracks.items ? spotifyResult.tracks.items[0] : null;
        if (firstResult) {
          return addSongToPlayList(firstResult);
        } else {
          logInfo('Could not find the song. Trying without an album: ' + previousTerm.artist + ' ' + previousTerm.song);
          return findSongOnSpotify(previousTerm.artist + ' ' + previousTerm.song)
            .then((spotifyResult) => {
              const firstResult = spotifyResult.tracks && spotifyResult.tracks.items ? spotifyResult.tracks.items[0] : null;
              if (firstResult) {
                return addSongToPlayList(firstResult);
              }
            });
        }
      },
      logError
    )
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
              },
              logError
            );
        }
      },
      logError
    );
  getCurrentSiriusSongAndAddToSpotify(120 * 1000);
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
      'Authorization': 'Basic ' + (new Buffer(spotifyConfig.client_id + ':' + spotifyConfig.client_secret).toString('base64'))
    },
    json: true
  };

  rp(authOptions)
    .then(
      (refreshResponse) => {
        logInfo('Call to refresh access token succeeded');
        access_token = refreshResponse.access_token;
      },
      logError
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

const logError = (error) => log('ERROR', error);

const logInfo = (info) => log('INFO', info);

const log = (level, msg) => console.log(level + ': ' + msg);

// start application
refreshSpotifyToken();
logInfo('Listening on 8888');
app.listen(8888);
