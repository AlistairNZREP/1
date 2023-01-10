from flask_expects_json import expects_json
from changedetectionio import queuedWatchMetaData
from flask_restful import abort, Resource
from flask import request, make_response
import validators
from . import auth
import copy

# Experimenting with `apidoc` for building docs
# node_modules/apidoc/bin/apidoc -i ../../changedetectionio/api/ -o apidoc
# https://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html


from . import api_schema

# Build a JSON Schema atleast partially based on our Watch model
from changedetectionio.model.Watch import base_config as watch_base_config
schema = api_schema.build_watch_json_schema(watch_base_config)

schema_create_watch = copy.deepcopy(schema)
schema_create_watch['required'] = ['url']

schema_update_watch = copy.deepcopy(schema)
schema_update_watch['additionalProperties'] = False

class Watch(Resource):
    def __init__(self, **kwargs):
        # datastore is a black box dependency
        self.datastore = kwargs['datastore']
        self.update_q = kwargs['update_q']

    # Get information about a single watch, excluding the history list (can be large)
    # curl http://localhost:4000/api/v1/watch/<string:uuid>
    # @todo - version2 - ?muted and ?paused should be able to be called together, return the watch struct not "OK"
    # ?recheck=true
    @auth.check_token
    def get(self, uuid):
        """
        @api {get} /api/v1/watch/:uuid Single watch information
        @apiName Watch
        @apiGroup Watch
        @apiVersion 0.1.0
        @apiParam {uuid} uuid Watch unique ID.
        @apiQuery {Boolean} [recheck] Recheck this watch `recheck=1`
        @apiQuery {String} [paused] `paused` or `unpaused`
        @apiQuery {String} [muted] `muted` or `unmuted`
        @apiSuccess (200) {String} OK When paused/muted/recheck operation OR full JSON object of the watch
        @apiSuccess (200) {JSON} WatchJSON JSON Full JSON object of the watch
        """
        from copy import deepcopy
        watch = deepcopy(self.datastore.data['watching'].get(uuid))
        if not watch:
            abort(404, message='No watch exists with the UUID of {}'.format(uuid))

        if request.args.get('recheck'):
            self.update_q.put(queuedWatchMetaData.PrioritizedItem(priority=1, item={'uuid': uuid, 'skip_when_checksum_same': True}))
            return "OK", 200
        if request.args.get('paused', '') == 'paused':
            self.datastore.data['watching'].get(uuid).pause()
            return "OK", 200
        elif request.args.get('paused', '') == 'unpaused':
            self.datastore.data['watching'].get(uuid).unpause()
            return "OK", 200
        if request.args.get('muted', '') == 'muted':
            self.datastore.data['watching'].get(uuid).mute()
            return "OK", 200
        elif request.args.get('muted', '') == 'unmuted':
            self.datastore.data['watching'].get(uuid).unmute()
            return "OK", 200

        # Return without history, get that via another API call
        watch['history_n'] = watch.history_n
        return watch

    @auth.check_token
    def delete(self, uuid):
        """
        @api {delete} /api/v1/watch/:uuid Delete watch information
        @apiParam {uuid} uuid Watch unique ID.
        @apiName Delete
        @apiGroup Watch
        @apiVersion 0.1.0
        @apiSuccess (200) {String} OK Was deleted
        """
        if not self.datastore.data['watching'].get(uuid):
            abort(400, message='No watch exists with the UUID of {}'.format(uuid))

        self.datastore.delete(uuid)
        return 'OK', 204

    # Update an existing
    @auth.check_token
    @expects_json(schema_update_watch)
    def put(self, uuid):
        """
        @api {put} /api/v1/watch/:uuid Update watch information The request must have the application/json content type
        @apiDescription Updates an existing watch using JSON, accepts the same structure as at https://github.com/dgtlmoon/changedetection.io/blob/fab7d325f764d6912bef671f1d78bf217689c537/changedetectionio/model/Watch.py#L15
        @apiParam {uuid} uuid Watch unique ID.
        @apiName Update
        @apiGroup Watch
        @apiVersion 0.1.0
        @apiSuccess (200) {String} OK Was updated
        @apiSuccess (500) {String} ERR Some other error
        """
        watch = self.datastore.data['watching'].get(uuid)
        if not watch:
            abort(404, message='No watch exists with the UUID of {}'.format(uuid))

        if request.json.get('proxy'):
            plist = self.datastore.proxy_list
            if not request.json.get('proxy') in plist:
                return "Invalid proxy choice, currently supported proxies are '{}'".format(', '.join(plist)), 400

        watch.update(request.json)

        return "OK", 200


class WatchHistory(Resource):
    def __init__(self, **kwargs):
        # datastore is a black box dependency
        self.datastore = kwargs['datastore']

    # Get a list of available history for a watch by UUID
    # curl http://localhost:4000/api/v1/watch/<string:uuid>/history
    def get(self, uuid):
        watch = self.datastore.data['watching'].get(uuid)
        if not watch:
            abort(404, message='No watch exists with the UUID of {}'.format(uuid))
        return watch.history, 200


class WatchSingleHistory(Resource):
    def __init__(self, **kwargs):
        # datastore is a black box dependency
        self.datastore = kwargs['datastore']

    # Read a given history snapshot and return its content
    # <string:timestamp> or "latest"
    # curl http://localhost:4000/api/v1/watch/<string:uuid>/history/<int:timestamp>
    @auth.check_token
    def get(self, uuid, timestamp):
        watch = self.datastore.data['watching'].get(uuid)
        if not watch:
            abort(404, message='No watch exists with the UUID of {}'.format(uuid))

        if not len(watch.history):
            abort(404, message='Watch found but no history exists for the UUID {}'.format(uuid))

        if timestamp == 'latest':
            timestamp = list(watch.history.keys())[-1]

        with open(watch.history[timestamp], 'r') as f:
            content = f.read()

        response = make_response(content, 200)
        response.mimetype = "text/plain"
        return response


class CreateWatch(Resource):
    def __init__(self, **kwargs):
        # datastore is a black box dependency
        self.datastore = kwargs['datastore']
        self.update_q = kwargs['update_q']

    @auth.check_token
    @expects_json(schema_create_watch)
    def post(self):
        """
        @api {post} /api/v1/watch Create a watch
        @apiDescription requires `url`, Creates a watch, also accepts accepts the same structure as at https://github.com/dgtlmoon/changedetection.io/blob/fab7d325f764d6912bef671f1d78bf217689c537/changedetectionio/model/Watch.py#L15
        @apiName Create
        @apiGroup CreateWatch
        @apiVersion 0.1.0
        @apiSuccess (200) {String} OK Was created
        @apiSuccess (500) {String} ERR Some other error
        """

        # curl http://localhost:4000/api/v1/watch -H "Content-Type: application/json" -d '{"url": "https://my-nice.com", "tag": "one, two" }'
        json_data = request.get_json()
        url = json_data['url'].strip()


        if not validators.url(json_data['url'].strip()):
            return "Invalid or unsupported URL", 400

        if json_data.get('proxy'):
            plist = self.datastore.proxy_list
            if not json_data.get('proxy') in plist:
                return "Invalid proxy choice, currently supported proxies are '{}'".format(', '.join(plist)), 400

        extras = copy.deepcopy(json_data)
        del extras['url']

        new_uuid = self.datastore.add_watch(url=url, extras=extras)
        self.update_q.put(queuedWatchMetaData.PrioritizedItem(priority=1, item={'uuid': new_uuid, 'skip_when_checksum_same': True}))
        return {'uuid': new_uuid}, 201

    # Return concise list of available watches and some very basic info
    # curl http://localhost:4000/api/v1/watch|python -mjson.tool
    # ?recheck_all=1 to recheck all, tag=sometag
    @auth.check_token
    def get(self):
        list = {}

        tag_limit = request.args.get('tag', None)
        for k, watch in self.datastore.data['watching'].items():
            if tag_limit:
                if not tag_limit.lower() in watch.all_tags:
                    continue

            list[k] = {'url': watch['url'],
                       'title': watch['title'],
                       'last_checked': watch['last_checked'],
                       'last_changed': watch.last_changed,
                       'last_error': watch['last_error']}

        if request.args.get('recheck_all'):
            for uuid in self.datastore.data['watching'].keys():
                self.update_q.put(queuedWatchMetaData.PrioritizedItem(priority=1, item={'uuid': uuid, 'skip_when_checksum_same': True}))
            return {'status': "OK"}, 200

        return list, 200

class SystemInfo(Resource):
    def __init__(self, **kwargs):
        # datastore is a black box dependency
        self.datastore = kwargs['datastore']
        self.update_q = kwargs['update_q']

    @auth.check_token
    def get(self):
        import time
        overdue_watches = []

        # Check all watches and report which have not been checked but should have been

        for uuid, watch in self.datastore.data.get('watching', {}).items():
            # see if now - last_checked is greater than the time that should have been
            # this is not super accurate (maybe they just edited it) but better than nothing
            t = watch.threshold_seconds()
            if not t:
                # Use the system wide default
                t = self.datastore.threshold_seconds

            time_since_check = time.time() - watch.get('last_checked')

            # Allow 5 minutes of grace time before we decide it's overdue
            if time_since_check - (5 * 60) > t:
                overdue_watches.append(uuid)

        return {
                   'queue_size': self.update_q.qsize(),
                   'overdue_watches': overdue_watches,
                   'uptime': round(time.time() - self.datastore.start_time, 2),
                   'watch_count': len(self.datastore.data.get('watching', {}))
               }, 200
