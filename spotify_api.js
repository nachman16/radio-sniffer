const rp = require('request-promise-native');
const spotifyConfig = require('./spotify_config');
const redirect_uri = 'http://localhost:8888/callback'; // Your redirect uri

module.exports = class {
  constructor(code) {
    this._authenticated = this._authenticateOnSpotify(code);
    setTimeout(this._refreshToken, 1000 * 60 * 30);
  }

  // private initialization method
  _authenticateOnSpotify(code) {
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
          this.access_token = authenticationInfo.access_token;
          this.refresh_token = authenticationInfo.refresh_token;
        });
  }

  _refreshToken() {
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

    setTimeout(this._refreshToken, 1000 * 60 * 30);

    rp(authOptions)
      .then(
        (refreshResponse) => {
          this.access_token = refreshResponse.access_token;
        });
  }

  // public methods
  addSongToPlayList(playlistId, spotifyTrack) {
    const options = {
      method: 'POST',
      uri: 'https://api.spotify.com/v1/playlists/' + playlistId + '/tracks?uris=' + spotifyTrack.uri,
      headers: {
        'Authorization': 'Bearer ' + this.access_token
      },
      json: true
    };
    return rp(options);
  }

  getPlaylist(playlistId) {
    const options = {
      uri: 'https://api.spotify.com/v1/playlists/' + playlistId,
      headers: {
        'Authorization': 'Bearer ' + this.access_token
      },
      json: true
    };
    return rp(options);
  }

  findSongOnSpotify(searchTerm) {
    const artistAlbumSongOptions = {
      uri: 'https://api.spotify.com/v1/search?type=track&q=' + encodeURIComponent(searchTerm.artist + ' ' + searchTerm.album + ' ' + searchTerm.song),
      headers: {
        'Authorization': 'Bearer ' + this.access_token
      },
      json: true
    };
    return rp(artistAlbumSongOptions)
      .then(
        (spotifyResult) => {
          const firstResult = spotifyResult && spotifyResult.tracks && spotifyResult.tracks.items ? spotifyResult.tracks.items[0] : null;
          if (firstResult) {
            return Promise.resolve(firstResult);
          }
          const artistSongOptions = {
            uri: 'https://api.spotify.com/v1/search?type=track&q=' + encodeURIComponent(searchTerm.artist + ' ' + searchTerm.song),
            headers: {
              'Authorization': 'Bearer ' + this.access_token
            },
            json: true
          };
          return rp(artistSongOptions)
            .then(
              (spotifyResult) => {
                const secondTry = spotifyResult && spotifyResult.tracks && spotifyResult.tracks.items ? spotifyResult.tracks.items[0] : null;
                if (secondTry) {
                  return Promise.resolve(secondTry);
                }
                return Promise.reject('Could not find song on Spotify');
              });
        }
      );
  }
  
  /**
   * Get all playlists that start with suffix.
   *
   * @param suffix playlist suffix
   * @returns {PromiseLike<T> | Promise<T>} Promise with result of fetching playlists
   */
  getPlaylists(suffix) {
    const options = {
      uri: 'https://api.spotify.com/v1/me/playlists',
      headers: {
        'Authorization': 'Bearer ' + this.access_token
      },
      json: true
    };
    return rp(options)
      .then(
        (playlistCollection) => {
          if (playlistCollection && playlistCollection.items) {
            return playlistCollection.items.filter((playlist) => playlist.name.startsWith(suffix));
          }
        });
  }

  /**
   * Get first 100 tracks of a playlist.
   *
   * @param playlistId
   * @returns {PromiseLike<T> | Promise<T>} Promise with result of fetching a playlist's tracks
   */
  getPlaylistTracks(playlistId) {
    const options = {
      uri: 'https://api.spotify.com/v1/playlists/' + playlistId + '/tracks',
      headers: {
        'Authorization': 'Bearer ' + this.access_token
      },
      json: true
    };
    return rp(options);
  }

  createNewPlaylist(name) {
    const options = {
      method: 'POST',
      uri: 'https://api.spotify.com/v1/users/' + spotifyConfig.userId + '/playlists',
      headers: {
        'Authorization': 'Bearer ' + this.access_token
      },
      body: {
        name: 'Sirius Real Jazz ' + (parseInt(name.split(' ').pop()) + 1)
      },
      json: true
    };
    return rp(options);
  }

  // getters
  /**
   * Authenticated promise.
   *
   * @returns {PromiseLike<T> | Promise<T>} Promise with authentication result
   */
  get authenticated() {
    return this._authenticated;
  }
};


