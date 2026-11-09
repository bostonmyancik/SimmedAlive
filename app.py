"""Life sim: a tiny Flask app that serves the ecosystem simulation.

Run with:  python3 app.py
Then open: http://127.0.0.1:5000
"""
from flask import Flask, render_template

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html")


if __name__ == "__main__":
    # Bound to localhost only, so nothing else on your network can reach it.
    app.run(host="127.0.0.1", port=5000, debug=False)
