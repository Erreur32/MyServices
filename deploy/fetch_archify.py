"""Construction de l'image : télécharge Archify (MIT, github.com/tt-a1i/archify) dans /opt/archify.

Version figée ; l'archive est vérifiée par son empreinte SHA-256 publiée (stable.json du projet) avant
d'être dépliée, et aucun chemin ne peut sortir de /opt. Aucune dépendance npm : Node suffit.
  python3 fetch_archify.py <version> <sha256>
"""
import hashlib
import io
import sys
import urllib.request
import zipfile

version, want = sys.argv[1], sys.argv[2]
url = f"https://github.com/tt-a1i/archify/releases/download/v{version}/archify.zip"
raw = urllib.request.urlopen(url, timeout=120).read()
got = hashlib.sha256(raw).hexdigest()
if got != want:
    sys.exit(f"archify.zip {version} : empreinte {got}, attendue {want}")
z = zipfile.ZipFile(io.BytesIO(raw))
for name in z.namelist():
    if name.startswith("/") or ".." in name.split("/") or not name.startswith("archify/"):
        sys.exit(f"archify.zip : chemin refusé {name}")
z.extractall("/opt")
print(f"Archify {version} -> /opt/archify ({len(z.namelist())} fichiers)")
