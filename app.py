"""Life sim: a small Flask app that serves the ecosystem simulation and keeps
saved worlds in a local SQLite file.

Run with:  python3 app.py
Then open: http://127.0.0.1:5000

The database defaults to data/lifesim.db next to this file. Set LIFESIM_DB to
put it somewhere else.
"""
import json
import os
from pathlib import Path

from flask import Flask, Response, jsonify, render_template, request

from storage import AUTOSAVE_NAME, SaveStore

DEFAULT_DB = Path(__file__).parent / "data" / "lifesim.db"
MAX_SAVE_BYTES = 16 * 1024 * 1024
MAX_NAME_LENGTH = 60


def create_app(db_path=None):
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = MAX_SAVE_BYTES
    store = SaveStore(db_path or os.environ.get("LIFESIM_DB") or DEFAULT_DB)

    def error(message, status):
        return jsonify({"error": message}), status

    def with_data(found):
        """A save's summary with its world attached, as a JSON response."""
        summary, data_text = found
        # The data is already JSON text, so splice it in rather than re-encoding it.
        body = json.dumps(summary)[:-1] + ', "data": ' + data_text + "}"
        return Response(body, mimetype="application/json")

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.get("/api/saves")
    def list_saves():
        return jsonify(store.list())

    @app.get("/api/saves/autosave")
    def get_autosave():
        found = store.get_autosave()
        return with_data(found) if found else error("There is no autosave yet.", 404)

    @app.get("/api/saves/<int:save_id>")
    def get_save(save_id):
        found = store.get(save_id)
        return with_data(found) if found else error("That save no longer exists.", 404)

    @app.put("/api/saves")
    def put_save():
        """Creates or overwrites the save with the given name.

        Body: { "name": str, "seed": int, "tick": int, "data": object }.
        The name "Autosave" is the autosave slot.
        """
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return error("Expected a JSON object.", 400)
        name, seed, tick, data = (body.get(key) for key in ("name", "seed", "tick", "data"))
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > MAX_NAME_LENGTH:
            return error(f"The name must be 1 to {MAX_NAME_LENGTH} characters.", 400)
        if not all(isinstance(value, int) and not isinstance(value, bool) and value >= 0 for value in (seed, tick)):
            return error("seed and tick must be whole numbers.", 400)
        if not isinstance(data, dict):
            return error("data must be a JSON object.", 400)
        name = name.strip()
        if name.lower() == AUTOSAVE_NAME.lower():
            name = AUTOSAVE_NAME
        return jsonify(store.put(name, seed, tick, json.dumps(data, separators=(",", ":"))))

    @app.delete("/api/saves/<int:save_id>")
    def delete_save(save_id):
        if not store.delete(save_id):
            return error("That save no longer exists.", 404)
        return "", 204

    return app


app = create_app()

if __name__ == "__main__":
    # Bound to localhost only, so nothing else on your network can reach it.
    app.run(host="127.0.0.1", port=5000, debug=False)
