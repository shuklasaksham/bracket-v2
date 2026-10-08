"""Print a bcrypt hash for ADMIN_PASSWORD_HASH (admin panel sign-in).

    python backend/scripts/admin_hash.py
Then set, on the server only:
    ADMIN_USERNAME=<your username>
    ADMIN_PASSWORD_HASH=<the printed hash>
The password is read without echo and never written anywhere.
"""
import getpass
import sys

from passlib.hash import bcrypt

pw = getpass.getpass("Admin password (min 12 characters): ")
if len(pw) < 12:
    sys.exit("Use at least 12 characters.")
if pw != getpass.getpass("Repeat it: "):
    sys.exit("The two passwords don't match.")
print(bcrypt.using(rounds=12).hash(pw))
