#!/usr/bin/python3
"""Closed-set UAT rollback executor protocol boundary.

Individually reviewed handlers may exist in a dormant repository-only state, but the
catalog intentionally remains fail-closed until every UAT database, named-volume,
runtime and postverify capability is implemented and dynamically exercised.  No TEST
restore tool is promoted through this path.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import fcntl
import selectors
import signal
import stat
import subprocess
import sys
import tarfile
import time
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


REQUEST_CONTRACT = "chenyida-erp-uat-promotion-rollback-runtime-request/v1"
FD_MANIFEST_CONTRACT = "chenyida-erp-uat-promotion-rollback-trusted-fd-manifest/v3"
EXECUTOR_CONTRACT = "chenyida-erp-uat-promotion-rollback-fixed-executor/v1"
RESPONSE_CONTRACT = "chenyida-erp-uat-promotion-rollback-runtime-response/v1"
HANDLER_UNKNOWN_CONTRACT = "chenyida-erp-uat-promotion-rollback-handler-unknown/v1"
RUNTIME_PROJECTION_CONTRACT = "chenyida-erp-uat-promotion-rollback-runtime-projection/v2"
RUNTIME_OBSERVATION_CONTRACT = \
    "chenyida-erp-uat-promotion-rollback-runtime-observation/v1"
COMPOSE_OVERLAY_CONTRACT = "chenyida-erp-uat-promotion-rollback-compose-overlay/v1"
POSTGRES_BASE_SPEC_CONTRACT = \
    "chenyida-erp-uat-rollback-postgresql-base-spec/v2"
POSTGRES_OPCODE_SPEC_CONTRACT = \
    "chenyida-erp-uat-rollback-postgresql-opcode-spec/v2"
POSTGRES_DUMP_OPCODE_SPEC_CONTRACT = \
    "chenyida-erp-uat-rollback-postgresql-dump-opcode-spec/v2"
POSTGRES_RECONCILE_OPCODE_SPEC_CONTRACT = \
    "chenyida-erp-uat-rollback-postgresql-reconcile-opcode-spec/v2"
POSTGRES_GUARDED_SWITCH_OPCODE_SPEC_CONTRACT = \
    "chenyida-erp-uat-rollback-postgresql-guarded-switch-opcode-spec/v2"
VOLUME_HELPER_CONTRACT_SHA256 = \
    "143071fae30de9f0f4c04dff1df17d5d42fd8bfaa967ca0e70836d5ffd1ffb8d"
VOLUME_HELPER_PROTOCOL = "chenyida-erp-volume-helper/v1"
VOLUME_HELPER_ENTRYPOINT = "/usr/local/bin/chenyida-erp-volume-helper"
POSTGRES_SQL_OPCODES = {
    "PG_RB_CREATE_STAGING_V1",
    "PG_RB_OBSERVE_STATE_V1",
    "PG_RB_OBSERVE_STAGING_RESTORE_PRECONDITION_V1",
    "PG_RB_ATOMIC_SWITCH_V1",
    "PG_RB_UNSEAL_ACTIVE_V1",
}
POSTGRES_READ_ONLY_SQL_OPCODES = {
    "PG_RB_OBSERVE_STATE_V1", "PG_RB_OBSERVE_STAGING_RESTORE_PRECONDITION_V1",
}
WRITER_SQL_OPCODES = {
    "PG_RB_OBSERVE_WRITER_FENCE_V1",
    "PG_RB_SEAL_ACTIVE_V1",
}
WRITER_SPEC_CONTRACT = "chenyida-erp-uat-rollback-writer-containment-spec/v1"
WRITER_OPCODE_SPEC_CONTRACT = \
    "chenyida-erp-uat-rollback-writer-postgresql-opcode-spec/v1"
RELEASE_RUNTIME_POLICY_SHA256 = \
    "e4920820ed954c2689e3de53dea9b7f36945969c8287b06d87a3871e7d3ecf00"
POST_DEPLOY_RUNTIME_GUARD = {
    "contract": "chenyida-erp-release-runtime-guard/v1",
    "mode": "POST_DEPLOY_CURRENT_RUNTIME_STRICT",
}
BACKUP_STATUS_DISPOSITION = \
    "RESTORED_HISTORICAL_EVIDENCE_REQUIRES_NEW_POST_ROLLBACK_BACKUP"
ACTIVATION_CONTRACT = "chenyida-erp-uat-promotion-rollback-runtime-activation/v2"
ACTIVATION_FILE = \
    "/var/lib/chenyida-erp-release-supervisor/uat-rollback-runtime-adapter/activation-v2.json"
CURRENT_FILE = \
    "/var/lib/chenyida-erp-release-supervisor/uat-rollback-runtime-adapter/current-v2.json"
EXECUTOR_FILE = "/usr/local/libexec/chenyida-erp-uat-rollback-executor-v1"
DOCKER_FILE = "/usr/bin/docker"
COMPOSE_PLUGIN_FILE = "/usr/libexec/docker/cli-plugins/docker-compose"
HANDLER_STATE_ROOT = \
    "/var/lib/chenyida-erp-release-supervisor/uat-rollback-runtime-adapter/handler-state-v1"
HANDLER_STATE_CONTRACT = "chenyida-erp-uat-promotion-rollback-handler-state-event/v1"
POSTDEPLOY_ROOT_BASE = "/var/lib/chenyida-erp/postdeploy"
RELEASE_IDENTITY_ROOT = "/var/lib/chenyida-erp/release-identity"
RELEASE_IDENTITY_FILE = f"{RELEASE_IDENTITY_ROOT}/release-identity.json"
RELEASE_ARTIFACT_MARKER = ".chenyida-erp-release-artifact-root-v1"
RELEASE_ARTIFACT_MARKER_VALUE = b"chenyida-erp-release-artifact-root/v1\n"
RELEASE_IDENTITY_MARKER = ".chenyida-erp-release-identity-root-v1"
RELEASE_IDENTITY_MARKER_VALUE = b"chenyida-erp-release-identity-root/v1\n"
RELEASE_IDENTITY_TRANSACTION_DIRECTORY = ".release-identity-transaction-v1"
RELEASE_IDENTITY_TRANSACTION_CONTRACT = \
    "chenyida-erp-runtime-release-identity-transaction/v1"
RELEASE_IDENTITY_READER_GID_KEY = "ERP_RELEASE_IDENTITY_READER_GID"
CATALOG_SHA256 = "f788b9eef1d677535e0a907504ff10c56e60d7007b7e62f4dc3a01561b4384a1"
CAPABILITY_STATUS = "BLOCKED_MISSING_UAT_CAPABLE_HANDLERS"
MAX_JSON_BYTES = 4 * 1024 * 1024
VOLUME_CAPACITY_RESERVE_BYTES = 10 * 1024 * 1024 * 1024
VOLUME_CAPACITY_RESERVE_INODES = 10_000
ACTION_DEADLINE_RESPONSE_RESERVE_SECONDS = 1.0
POSTGRES_CONTENT_REPORT_MAX_BYTES = 64 * 1024 * 1024
POSTGRES_CONTENT_SQL_SHA256 = \
    "b0486448ec248ca76d687060b5c2d564db3d9b423fa1febb9ab33460c99550fc"
POSTGRES_SECURITY_SQL_SHA256 = \
    "4fd1e6a749d24025918152a51591601bb1ec6f1d767acda98d03656846bf334b"
POSTGRES_CONTENT_SQL_ZLIB_BASE64 = (
    "eNrNVm1v2zYQ/q5fcStaSBkc127SLEu2AY6jti4cq7PVdR2CCbTE2GxkUhWpvBTFfvse0ootJ0u2AP0wJLDI4/Hu4XPH451qbiga"
    "JeF4HI2TSRy9IyW908KKz1S5YIYqyXIxkzyrxaYqcq4TJfPrhq7geaZ5Qf6p8T3vKHw9GFE87o0mvX48iEY0mETDnhsNw9/CIY3D"
    "d2Ev7h0NQwx7xy33CyTDj4feJIxpGPV7Q8pVep4YseCqMvQz+S+131zWhhm+4NI0dV7sdja1RJbzRMjElExqlhqhZKK51vbb2Nd1"
    "xr3tbeozqaRIWd6iImdCGn5lts9KzmkK1VRBIM225lILIy44UM6sNpUca6nIBbM+LH/WmplzYkWRQ8WJM2bYlGlOWbUo2hRNP/HU"
    "kGQLromVnN7Hr7b3ac6vSCuCqn4u+WUuJNfWmpA4D9wLMF5qSpmUyhDLDS+pVJe6TZPl0YBGZrwUckZCIz5XPCN+ZWEIg8hpZa3x"
    "z5W4YDnsET4VEMyZntcecCQosrRUGo7yShvr8VKYOWXi7IyXdlvGz1iVG912hMeg8w8lueXzfdyvw3CMKE3Mde7ESIQWfTw5rtcG"
    "ILOE79W60CrZ3+t063VQX7LkLFfMJJmYCaOhtLNcm14bzhKEr1hGEJy5XcOwH9fZG3hET1dp8hSzD4P4jWUqsSfFgXsTskpE9T4u"
    "U5XxAL64NgECesFL5JcKjEo+aSWngVZVmfIENrYODmxutOxhX+37WxjoOXvxcs8NLZwta99R63y8Gkcn9GzQfjaw8rUhLGIHm81K"
    "PgNWh+02MjckpF8lTfB97doq2cM4aWulgpDqlAe6WgRB4F/59PUr6WqqTRk4MC3q4n9vC1amwgR7u24wQ6pjIKsF8iYFoE7Dy7z7"
    "KPM/PNr+i8fY39l5tP2dx9jf/fHR9nfXEV6nlw2st8qtZ8M6YVaDW7G7N/lsYcENuNSBf+C3GiG3cbHc2fMBw9ZDuejV8Dbz7HDz"
    "ilggsi11YSuSnaTtkuc3E38cLsu4b2c13AbO1U5Lqd92zK4NNLAtAW15DlAxS9Kc2SrjvY3wcGDu6mHBUk4SrwIQKZHhjq9suTXv"
    "w5twHC6F50JmhL2BX4Igv7A/C3fm3uiYRlG8VBPYWBphK3G9tIb80y8oP3JZONwjkc75gvl39L77i/w/gdH3ovFxOKajj43FfjQE"
    "QyE96T9preE2xd7pjF/x1Ltbqfx78wTsmMTlZi0QOrH1mWd1Bq4ry6ELDUz9+j4c9cNvEqj7k+KbhxB1fOL/T0JjeQx/j8PR5P6M"
    "523Qfy9p9+hjYt/o/7hlzfydC3TDPWzadgTPPv83/leAm/yvhI7pIi9m+nPeIHG93mBr2S31Gr3NQsxKN9JoDJAPaGekInxnnJRrd"
    "NCgxGiIUlaYCqvLTsNco0dZdje2tcJ+13qg85yiKTAKvQzL7JGcpaUhKhiK5CExaRXR2UCGFmfBDbMdlrWGKkkLdo5H/nZnxkROU"
    "450QmtGU5aeV4VtpSBDv5PyApbanusUnMdk6RJN5AXgqfL65m2u7+vNm2zFtaoT3RTcTeTJCiPi+IWXKtlwgkuEuFuYm0669Jz6v"
    "UlIiNhoww2C2qHYSrsUDqHRoRC3AttxS9JzdO41jn8+DK7wOt2HvfHrMImO3mI+cSnf9FQXH6vYad6Huw+W3zlY/fkPPkoPIeuPo8"
    "mEXEI/QFSdww9otGsiwFQXWduPTk4G8aH3N1zRG5o="
)
POSTGRES_SECURITY_SQL_ZLIB_BASE64 = (
    "eNrtHGlz28b1O38FxuPMkhlYld0m7chROjQF20wpUiEgO0qUwYDgikIMAgwA2tbU/e99ewG7iwUJUvKh1p6xCOzx9u273x64zHFh"
    "Tca+M51Opr7rTc6sNOlcktKfz4eOR946LvyGcYSTwl9Gib/EeR4scG4dW++CLImSxVPa5CQosFvcxBgq0NCd2NbF6QlidcOkwNnb"
    "IC7rozz1//H94WNe70VL/Gua0Kpzb8BLZzcFDvx0XazWBam5xu95DX5fZIF/FadB4c+jRVQQbP7K6nIcZOG1vwqKayhcLfwwKII4"
    "5Vhm6Ts/x+E6i4obqE6vrlh5nIZv/ALQSNlY3+V8qLyAeS3J5KXa7w9JdecyurKO/v1P/H6FwwLP/TmMNAty/J/OJY5z3DmZWA/D"
    "m7mfrRPS2V9l0dsoxgvsXwVRvM7ww84z58Vw3LGsaX/oOpbzy8A584aTsYVqQK0otzL85zrK8BwGd8YnnS3AnwIayTy6Enguo0UW"
    "FFGa+Om7BGd3gaUG8vY4ltNeBtmbu8FRA3mHOOY3OciGH81BPKKr6I7RrUG/BeYCdVCOmIAuggUorr9M5yCsluU6I2fgWV14tCxQ"
    "jozIuxC8bu/4qC6OiLbtj0+s/Dqd/eHPcR5m0YrIQle0OUijuY1ABctOCijGjwpQmCZFlsYHtYkfHRWg8XLXWhMJCkd/nePsOAdj"
    "RaSTvJQtnF+GrudaXT7rx9bz6eSUWAoYHOwa+Wu9fulMHfp4AH+SYImPZcAUjqjN1yuc9WoIgBUtgMhdBO3f4syH/xSXZL0EOqDH"
    "fz88fHyImrvN8VWwjsHuZEGSByHVsgwHcz9N4hsCAYxX1b2kOXmI4/QdUDMx1pKKOFpGxfFhWS9oEaYgS91veyVJ5jNKFYGVxX9p"
    "R/pvMJ24rvXTZDi2Rn3PmfZH1jpJcF50edMD+IUhr6JFz4qAaVVXRmOpmcDyWBYgJmNVI4IOx5z/Iw0IZGs0/Jdjbabb8TdAucc1"
    "UeDgahKxefr7zv1OJi5mfbxlwmnChKQS0PHE+6wT75pmfmhNpltJ0lNmr9Hmhx8PdxWFPQhD4gGfgHpLIgjxoMxPFBJli+Z1npb1"
    "q2j+w48AcxaEb8BO+/De7e2B0yrDqwCcgv8eQOeWeFWQEoUHdcLCAzFwhoEBdpT7ESFamIL9uuluMHNxBDY58YP5PAOri3Nior6t"
    "DBTAWmBmPWc3MFF5+PksIJ5BiyZI357Vdy3NaxVBRiBBPBmROZYiKwIl8dBRBJVEgszBcO/R7QmP0xFE0klyXPeF0PZyAXMmv8Sn"
    "bsbt9uHA9HzsDU8d/2w6fDUcOS8cCNNB5XzX6Y+cE/ICHV/4Xn/6wvH84fhVfzQ8aRsdEARZZINjFiBwipApiY5fg4T/mSDhS7L8"
    "zJ1pVp+SFWALshOTqRK+pDkhNzfz4TVOwKQElz7OVpf+N8hy3EH/DGouUU/1GXfle/b3vJ/SplJS1u2qLUtpT1hZSfW/KAvbjNfH"
    "s66DydibTkbEwt7eslI6/X9ZT6UFWqV5sQABRl/N31fzd1vzdzcR5U1SXOMiCr+wYLIJrY8YR16MvZeONxzc3tCxlabB1AG4luec"
    "nlle/9nIsWQQXLeWAbyGuQWYDSanp0PPOps6rjN95VjTyWsXWNThKkDjJ5o5ufTZJwavzlhmv1iywID7NKepR20dQ9RWh/e0nAjo"
    "xtQ5G/UHjvX8fDyg1ASAwPPVQW1mBFpXoGlRtZk63vl07FoEv86oP35x3n8Byf+fseUy8pz1wYyMnJHl9p87HZjBw4eVvxj0gY2A"
    "8bicPKirR97R2fmz0XAAyj6CJmEKaUgeYmbXhP1QaFHKthn1iimMQM0NDkpUjPMvq3s2RYZMoTKD45rals3V4JlPEszs88n01J+8"
    "HjtT1A6O7A85Pzm4egWHSInYCJE2IupAzAdVi4e7C0h+HTz57vsuqPQaU2nYJBvD09NzJh6uNx0CKw1SImQEJyGkaF0OH8wQmFUw"
    "yikbykbn3vN/gCOw6QZKz6K4k62NjeabbI4kT5k9sbxpf+z22dSG7gR4Qp5GzivAB+YOZKCoAj1ObPoXFHt0AcO8HnovOyA2wYIk"
    "lFQH+8z5aupty/poK0lT+RYl1ziLivI9BGQLTN60ovmMSV5ZGiRxCul52SzDqzgKqb5XXcWyaFlCjS9hXlwWzW5WQZ5ncS65Csm0"
    "WIaUsIWT7oCmUFkjPjGb6zT6I0+TmT9bRzGwZvYHhGdMyxEBj1TKsQpKNyLGSCMlq+aERDXKsmpGRDovZCK20qqMOxt4gID4PqW+"
    "1ELwg7WQuIGMLOKAgEGYSSnlEzKwjrWkjPMp55CtWlCVryDM1vh8NGLWgT5RQ1CkfngdZF1Dj75nET9q/ToZO2yz0kYX8O/R6emj"
    "k5MH3oOXL5/87eh0eOS6B6fug18fIGoxOGZMfnwQIGSUKRqcMClQ+EodWwpa/QbfCNFT1YrKH8jREi9nEERfR6tdpYnxG9xgAtzT"
    "BIpBRTb71SpplxRqN7vFCrMD3oM7CBTMycZyumISILWTK1TZNbVWq4QqYGPbqlijujb/Dx/C66z7uPfhgzr1qnznSZt4CUCCdXHt"
    "8+ZW1Q1aiIiTMZojSEIngStxxdJApB2NGtWOrAXpx6eidWOPpQ3TCNHCjBFPqFKppe3j8f4+AuvnYbrCspbXcyzm+sF78lhJUaxK"
    "N8vAYBNIKWnSwerxvgSaAwClB8tC59PtT6f9CxGn0S0LKgibs0mg8IkztZ5dsLfBZESyUOvB4EGvp8kxvJYxoeIhKMa9Sn7LVjr+"
    "vGWDuDbnySPnuaeJHs1rJ+PS2x9rTNJ71bIv0lnORo8NLOls2lgzZdQl8DJfa0jTeO4L4m3OnztWU45dZfk7hgQwJigGE3c/COMG"
    "3UAnJPQCQZUSoDdRMrd1ZlbVbEGnuNlirWtLidCVRsxMpDd3LhNFxejxZ3unvhhXfTH3OFWTKiMtblbYriqi3KddghmVrpZpvVjT"
    "AYLj96uYRNVG9YB6G/7zALqL5sjW6dXrVWjusiTAVjZ0GvzwowYfQJ6PSRAOOiqJgzt46Zz2kU2A56sgxAdJvqLKvJnoSnvK5t5+"
    "fN6Zufb+zCyRtsqn9uxUZqzzM9EoyChiZGmN0pB9rmcQuqImTtYhNzCTJlUQXjJ4B+jDhwzHNCI+gIcWXJWb3xemhjEEw5bAXApi"
    "DNwmXqGiJnELOoFYM8KIZj61lxkZui4yJNWqkdsoMXIzYquPoW+TrNRANum98/O5Mx58lZZ7Ii3uLaTFvbW0TCfn3nCsCUu6hqCF"
    "cCBl+Q3qUhFaAe64C9R6C5EIhIHAlrwrNQ6yBS3r2ci2AKJNYkvU25YMShDui6wBqqHF8d5Z0lTq3rGgSdzQ5OyKLDNolDaKmUma"
    "tI5NXuriTJUkQs0D+NPC5Iim90UESCuL/NmV/zJNWjJfSYhUO0dTKaHrMngopIl/S8ER3XSp8SBPVThjFJlu2Z/8HqMZs0uiEMd4"
    "eXzYI7mP3I5ub5KAGUGKTbwmWiLaSIMWqtDozMQJv7pNDMVGZ4NlVKazKdxyz/rEi1LGM9bkq7CNJCsd7o08l1hb1eMO8qNMWpei"
    "QifjbubH0LeBcSOycelPnv0Eb8iOyc4pXygiysEy3y1UVTrF6fK+MJDizVcJlrgISJZoyZNpz0ydBDo7RxppSyq1Zaixt7bKQdbG"
    "2i7/Ec1HBMUDuuKBxMIGKyuXORA/80QK2QJGtWBNysSqBOKISqVivQGpbGEtNFYhmUMcBZVn8uqcwLpahpNxVks5KmqhOrqhQ5qZ"
    "Fu4MC0rwrDEhh84BQM7TdRbiu1xy0hYxyjUluqmvLbCQSiKD4CuOjh6Q7ZgHvMgnw21a1NnpAMZuyyj15N2urSSgpMR482rF1iWE"
    "/RcGaqmAracjKDNhqQUanyKdas6Kb5XstqCA+4VTwEWfM4HT439byzMguTCQT86SPkWOtHtKosSCthwDQ+BrmNF9Cfq/2Kh8j2Db"
    "EPzZ9WgTQkwTvxqC2r1DR2PgYpviJQiSDAhtD9LM/nfH7VAWDzGnzUIivmNexkW8rnTHrJ7HR5ujVt619Nbl1j3FNyjU/VLWmDhx"
    "5YAFIo+ItQmDbB4lQQx4dKv2vXJf1Tk98y74zipyfjkbDQdDD0l7qmRksgvq0zuLyJYBlkFtBVmOZatSGkrYtcn1ejJtqnOPOQwj"
    "QGsniBlbgsWia2BQLYBsjPi1MNKcAPSqfeAmQMreMMeUyqMp9N+bSkrgL98104L/Y70vOxhso99+B4WhBNP3ryU5rqJbTYC3RLh6"
    "HMt+ibKFabxeJhv2VbcoGQLqnp+OkZx0bIhFwJ+S4qAosmi2LoCmRSGdn2mlgE2r821P3xjyVKk/SXt2TlvNudHtRLt+iqFOzDLX"
    "Uei5XjJz3fZkTn1CUs8mrWo4uiMQsconKVbY4saVWQhf/vm3MRS0iGU2JPk6A3ggQI75K1VRPs/S1Qrz668aZOojoAv1E613NkD8"
    "xPlVquvkzE5rLW6lcRL4A/IcxqROiH0eXuNlIPmDeq7Izs8IJWd2idkP6irr8KENlTLqIFF5aJmle7zUFaVlFsQrrkSFSA54uVeC"
    "IVExL0xKKCzT5X72fOyen51Npp5zgsrzzoo27kUyw2GjJmpVTe8LjZrOR1WYy7PQY/xWCl6nQnXgQdODHd3ZV0Vox+T75mt55L+X"
    "w/2q4jr3P0NI8anMx7YwoN63IRYwHVkzigqxWKsgAwwKyAX2sFllZxBp8XgAT7ufSL/neqpP/mOK6Z6wm4+7KyJQzWWrQCqz1mSR"
    "ZHZryPqW0hrQfndqDEtSOzjM5s1gxO4cyAfBqwUFjlqQZcENXUlgjatkn7/Lqb1yalwblw3V4916Nj1y/tvvLE367fdykSNO2T0b"
    "fkPNPDt+u0xZX/NFT3lkujKgSWudnA1S0bR2x2yMAQxJHOjaZWUzEb0PvwA3EsSo1+l1NrKcxy/i5jmynxCqIHqZNwgJMHFM+xHO"
    "Vo/EVfY/40ecMo9K+XtEF8L+8vYJoiDYFV5kM8HaInfy/QOgoHSeuFqHFA1rN/PbMG7Lzf9eCZ19MqANyJ2+SiB/16h5467dFeud"
    "9vfozBBOFlGC2zPD8D0Cu9VHC0o60luZ0IySULz44mZZibuoqToSpYrJZev0LXApE0GyNFloIWp5IBOKQCaOZqGIbiJRGIVrUTYT"
    "ZWTWMAsR8qyTNwkYKinYpUoQx3RpV/18HC0EvWC+TaljCz2sCSFJqVU6BF7RSih253Z1KbEtv5nZr1+BaZcgaWf/SwLSD/H5/OKi"
    "Cr78Rp9tuNho/FxfCbW8t1uaQ5PDakVaoWlGu0siSdWwK98MUwy0tQeXROa4jUecOYZ8ohV3TCf5FbLsuTPPJkEvOMnbArX9AOYD"
    "Ky8u3J7Bj8uXgNXVcTpWdVnvzkasXxc1jCtf9LqzkbVLf4Zhq6X8uxpTO2m0cUyxffARxtY2+AxoVBsUdzV8fctj47Bc98TmmqKi"
    "4iOhR0cRZA8LcEKbF8JvtxT+aRbDP96SduWUuNmuEiu2aH1XHK4vhxs4XEPiowzfLGF1ImTUQzIp2ypg0iAMnpJG3tVUjMsThslo"
    "7XaZiNKVK5+eut4ZaxqTYpMJqLVtPScpcuAXcdsmaWxo+UhE+1FNpysg62NpDflKC/2+0NPOfwGGZCDz"
)
TIMEOUTS = {
    "PREFLIGHT": 120,
    "RECHECK": 120,
    "PREPARE": 120,
    "EXECUTE": 1800,
    "PROBE": 300,
    "CONTAIN": 300,
}
POSTGRES_CONTENT_PROBE_TIMEOUT_SECONDS = 1200
ZERO_SHA256 = "0" * 64
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}\Z")
LABEL = re.compile(r"[A-Z][A-Z0-9_]{1,79}\Z")
ISO_UTC = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\Z")
DOCKER_CREATED_AT = re.compile(
    r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?"
    r"(?:Z|[+-]\d{2}:\d{2})\Z"
)
FD_PATH = re.compile(r"/proc/self/fd/([3-9]|[1-9][0-9]{1,5})\Z")
CONTAINER_ID = re.compile(r"[0-9a-f]{64}\Z")
IMAGE_DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
IMAGE_REFERENCE = re.compile(
    r"[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?"
    r"(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[0-9a-f]{64}\Z"
)
DATABASE_IDENTIFIER = re.compile(r"[a-z][a-z0-9_]{0,62}\Z")
RESTORED_STAGING_MARKER = re.compile(
    r"chenyida-erp-uat-rollback/v1:[A-Za-z0-9][A-Za-z0-9._-]{0,119}:RESTORED_STAGING\Z"
)
CANDIDATE_QUARANTINE_MARKER = re.compile(
    r"chenyida-erp-uat-rollback/v1:[A-Za-z0-9][A-Za-z0-9._-]{0,119}:CANDIDATE_QUARANTINE\Z"
)
MIGRATION = re.compile(r"[0-9]{4}_[a-z0-9_]+\.sql\Z")
VERSION = re.compile(r"0\.1\.0-alpha\.[0-9]+\Z")
COMMIT = re.compile(r"[0-9a-f]{40}\Z")
OID = re.compile(r"[1-9][0-9]{0,9}\Z")
SYSTEM_IDENTIFIER = re.compile(r"[1-9][0-9]{9,29}\Z")
HEALTH_DATABASE_TIME_MAX_SKEW_SECONDS = 5
RUNTIME_WRITER_SESSION_CLIENTS = {
    "WEB": {
        "role": "chenyida_erp_web", "application_name": "chenyida-erp-web",
        "pool_maximum": 10,
    },
    "WORKER": {
        "role": "chenyida_erp_worker", "application_name": "chenyida-erp-worker",
        "pool_maximum": 4,
    },
}
RUNTIME_WRITER_SESSION_TOTAL_MAXIMUM = sum(
    item["pool_maximum"] for item in RUNTIME_WRITER_SESSION_CLIENTS.values()
)


def action_timeout_seconds(action: str, label: str | None) -> int:
    if action == "PROBE" and label == "POSTGRESQL_CONTENT":
        return POSTGRES_CONTENT_PROBE_TIMEOUT_SECONDS
    return TIMEOUTS.get(action, 0)

STAGES = (
    "PRECONDITION_RECHECK", "WRITER_CONTAINMENT", "POSTGRESQL_RESTORE",
    "UPLOADS_RESTORE", "ATTACHMENTS_RESTORE", "BACKUP_STATUS_RESTORE",
    "RUNTIME_CONFIGURATION_RESTORE", "WEB_WORKER_PREDECESSOR_ACTIVATION",
    "PROTECTED_RESOURCE_RECHECK",
)
CHECKS = (
    "POSTGRESQL_CONTENT", "UPLOADS_CONTENT", "ATTACHMENTS_CONTENT",
    "BACKUP_STATUS_CONTENT", "MIGRATION_HEAD", "CADDY_IDENTITY",
    "POSTGRES_IDENTITY", "WEB_IDENTITY", "WORKER_IDENTITY",
    "RUNTIME_CONFIGURATION", "STRICT_RELEASE_IDENTITY", "HEALTH",
    "PROTECTED_RESOURCES",
)
PACKAGE_SOURCE_ROLES = (
    "snapshot_readiness", "snapshot_manifest", "snapshot_migrations",
    "snapshot_reconciliation", "snapshot_postgresql", "snapshot_uploads",
    "snapshot_attachments", "snapshot_backup_status", "snapshot_policy",
    "snapshot_policy_activation", "snapshot_runtime_privilege_access",
    "snapshot_runtime_privilege_compiled_catalog", "snapshot_runtime_privilege_policy",
    "snapshot_runtime_privilege_operator_policy", "predecessor_postdeploy_receipt",
    "predecessor_release_manifest", "candidate_deployment_result",
    "candidate_postdeploy_identity", "compose_file", "compose_release_file",
    "deployment_environment", "runtime_policy", "runtime_adapter_activation",
)
SOURCE_ROLES = set(PACKAGE_SOURCE_ROLES)
STAGE_SOURCE_ROLES = {
    "PRECONDITION_RECHECK": (
        "snapshot_readiness", "snapshot_manifest", "snapshot_migrations",
        "snapshot_reconciliation", "snapshot_policy", "snapshot_policy_activation",
        "snapshot_runtime_privilege_access", "snapshot_runtime_privilege_compiled_catalog",
        "snapshot_runtime_privilege_policy", "snapshot_runtime_privilege_operator_policy",
        "predecessor_postdeploy_receipt", "predecessor_release_manifest",
        "candidate_deployment_result", "candidate_postdeploy_identity", "compose_file",
        "compose_release_file", "deployment_environment", "runtime_policy",
    ),
    "WRITER_CONTAINMENT": ("candidate_deployment_result", "candidate_postdeploy_identity"),
    "POSTGRESQL_RESTORE": (
        "snapshot_readiness", "snapshot_manifest", "snapshot_migrations",
        "snapshot_reconciliation", "snapshot_postgresql", "snapshot_policy",
        "snapshot_policy_activation", "snapshot_runtime_privilege_access",
        "snapshot_runtime_privilege_compiled_catalog", "snapshot_runtime_privilege_policy",
        "snapshot_runtime_privilege_operator_policy",
    ),
    "UPLOADS_RESTORE": ("snapshot_manifest", "snapshot_uploads"),
    "ATTACHMENTS_RESTORE": ("snapshot_manifest", "snapshot_attachments"),
    "BACKUP_STATUS_RESTORE": ("snapshot_manifest", "snapshot_backup_status"),
    "RUNTIME_CONFIGURATION_RESTORE": (
        "compose_file", "compose_release_file", "deployment_environment", "runtime_policy",
    ),
    "WEB_WORKER_PREDECESSOR_ACTIVATION": (
        "snapshot_postgresql", "snapshot_manifest", "snapshot_migrations",
        "snapshot_reconciliation", "snapshot_policy_activation",
        "snapshot_runtime_privilege_access", "snapshot_runtime_privilege_compiled_catalog",
        "snapshot_runtime_privilege_policy", "snapshot_runtime_privilege_operator_policy",
        "predecessor_postdeploy_receipt", "predecessor_release_manifest",
        "compose_file", "compose_release_file", "deployment_environment", "runtime_policy",
    ),
    "PROTECTED_RESOURCE_RECHECK": (
        "candidate_deployment_result", "candidate_postdeploy_identity",
    ),
}
CHECK_SOURCE_ROLES = {
    "POSTGRESQL_CONTENT": (
        "snapshot_postgresql", "snapshot_manifest", "snapshot_migrations",
        "snapshot_reconciliation", "snapshot_runtime_privilege_access",
        "snapshot_runtime_privilege_compiled_catalog", "snapshot_runtime_privilege_policy",
        "snapshot_runtime_privilege_operator_policy",
    ),
    "UPLOADS_CONTENT": ("snapshot_uploads", "snapshot_manifest", "snapshot_reconciliation"),
    "ATTACHMENTS_CONTENT": (
        "snapshot_attachments", "snapshot_manifest", "snapshot_reconciliation",
    ),
    "BACKUP_STATUS_CONTENT": (
        "snapshot_backup_status", "snapshot_manifest", "snapshot_reconciliation",
    ),
    "MIGRATION_HEAD": ("snapshot_migrations", "predecessor_release_manifest"),
    "CADDY_IDENTITY": ("candidate_deployment_result",),
    "POSTGRES_IDENTITY": ("candidate_deployment_result",),
    "WEB_IDENTITY": ("predecessor_postdeploy_receipt", "predecessor_release_manifest"),
    "WORKER_IDENTITY": ("predecessor_postdeploy_receipt", "predecessor_release_manifest"),
    "RUNTIME_CONFIGURATION": ("deployment_environment", "runtime_policy"),
    "STRICT_RELEASE_IDENTITY": (
        "predecessor_postdeploy_receipt", "predecessor_release_manifest",
        "deployment_environment",
    ),
    "HEALTH": (
        "predecessor_postdeploy_receipt", "predecessor_release_manifest",
        "candidate_deployment_result", "deployment_environment",
    ),
    "PROTECTED_RESOURCES": ("candidate_deployment_result", "candidate_postdeploy_identity"),
}
INTERNAL_HANDLERS = {
    "PRECONDITION_RECHECK", "RUNTIME_CONFIGURATION_RESTORE",
    "PROTECTED_RESOURCE_RECHECK", "RUNTIME_CONFIGURATION", "STRICT_RELEASE_IDENTITY",
    "PROTECTED_RESOURCES",
}
VOLUME_EXECUTION_HANDLERS = {
    "UPLOADS_RESTORE", "ATTACHMENTS_RESTORE", "BACKUP_STATUS_RESTORE",
}
WRITER_EXECUTION_HANDLERS = {"WRITER_CONTAINMENT"}
POSTGRES_EXECUTION_HANDLERS = {"POSTGRESQL_RESTORE"}
POSTGRES_POSTVERIFY_HANDLERS = {"POSTGRESQL_CONTENT", "MIGRATION_HEAD"}
ACTIVATION_EXECUTION_HANDLERS = {"WEB_WORKER_PREDECESSOR_ACTIVATION"}
PROTECTED_EXECUTION_HANDLERS = {"PROTECTED_RESOURCE_RECHECK"}
VOLUME_POSTVERIFY_HANDLERS = {
    "UPLOADS_CONTENT", "ATTACHMENTS_CONTENT", "BACKUP_STATUS_CONTENT",
}
SERVICE_POSTVERIFY_HANDLERS = {
    "CADDY_IDENTITY", "POSTGRES_IDENTITY", "WEB_IDENTITY", "WORKER_IDENTITY",
}
HEALTH_POSTVERIFY_HANDLERS = {"HEALTH"}
METADATA_POSTVERIFY_HANDLERS = {
    "RUNTIME_CONFIGURATION", "STRICT_RELEASE_IDENTITY", "PROTECTED_RESOURCES",
}
VOLUME_SOURCE_DRIFT_CODES = {
    "ROLLBACK_FIXED_EXECUTOR_VOLUME_RESTORE_SPEC_INVALID",
    "ROLLBACK_FIXED_EXECUTOR_VOLUME_METADATA_POLICY_INVALID",
    "ROLLBACK_FIXED_EXECUTOR_ARCHIVE_INVALID",
    "ROLLBACK_FIXED_EXECUTOR_ARCHIVE_METADATA_INVALID",
    "ROLLBACK_FIXED_EXECUTOR_VOLUME_ARCHIVE_TREE_MISMATCH",
    "ROLLBACK_FIXED_EXECUTOR_SOURCE_FD_INVALID",
}
DORMANT_CAPABILITY_HANDLERS = {
    "PRECONDITION_RECHECK", "RUNTIME_CONFIGURATION_RESTORE",
} | WRITER_EXECUTION_HANDLERS | POSTGRES_EXECUTION_HANDLERS \
    | VOLUME_EXECUTION_HANDLERS | ACTIVATION_EXECUTION_HANDLERS \
    | PROTECTED_EXECUTION_HANDLERS | VOLUME_POSTVERIFY_HANDLERS \
    | POSTGRES_POSTVERIFY_HANDLERS | SERVICE_POSTVERIFY_HANDLERS \
    | HEALTH_POSTVERIFY_HANDLERS | METADATA_POSTVERIFY_HANDLERS
HANDLERS = {
    label: f"chenyida-erp.rollback.{label.lower().replace('_', '-')}.v1"
    for label in (*STAGES, *CHECKS)
}
UNAVAILABLE: set[str] = set()
REQUEST_FIELDS = {
    "schema_version", "contract", "action", "operation", "operation_id", "execution_mode",
    "label", "execution_package_sha256", "source_set_sha256", "transaction_intent_sha256",
    "record_intent_sha256", "runtime_plan_sha256", "previous_result_sha256", "context_sha256",
    "source_roles", "payload_sha256", "payload", "requested_at", "execution_deadline",
    "authorization_expires_at", "action_deadline", "request_sha256",
}
MANIFEST_FIELDS = {
    "schema_version", "contract", "request_sha256", "action", "operation", "operation_id",
    "execution_mode", "label", "runtime_plan_sha256", "execution_package_sha256",
    "transaction_intent_sha256", "record_intent_sha256", "source_set_sha256",
    "previous_result_sha256", "action_deadline", "handler_id", "argv_template_sha256",
    "idempotency_key", "activation", "executor", "docker", "compose_plugin",
    "activation_chain", "sources",
    "inherited_fds", "manifest_sha256",
}
DESCRIPTOR_FIELDS = {
    "fd", "path", "logical_path", "sha256", "uid", "gid", "mode", "device", "inode", "nlink",
}
HANDLER_EVENT_FIELDS = {
    "schema_version", "contract", "operation", "operation_id", "execution_mode", "label",
    "sequence", "event", "action", "idempotency_key", "request_sha256",
    "runtime_plan_sha256", "execution_package_sha256", "source_set_sha256",
    "transaction_intent_sha256", "context_sha256",
    "record_intent_sha256", "previous_result_sha256", "activation_receipt_sha256",
    "side_effect_name", "side_effect_identity_sha256", "payload", "payload_sha256",
    "previous_event_sha256", "recorded_at", "event_sha256",
}
HANDLER_EVENTS = {
    "PREPARED", "EXECUTION_STARTED", "SIDE_EFFECT_STARTED", "SIDE_EFFECT_RECORDED",
    "SIDE_EFFECT_RECOVERY_STARTED", "READ_ONLY_PROOF_RECORDED", "RESULT_COMMITTED",
    "RESULT_VERIFIED", "UNKNOWN", "CONTAINMENT_STARTED", "CONTAINED",
}
HANDLER_UNKNOWN_REASONS = {
    "DURABLE_STATE_MISSING", "DURABLE_STATE_DIVERGED", "SIDE_EFFECT_OUTCOME_UNKNOWN",
    "COMMIT_OUTCOME_UNKNOWN", "TARGET_IDENTITY_DRIFT", "SOURCE_IDENTITY_DRIFT",
    "TOOL_TIMEOUT", "TOOL_SIGNAL", "TOOL_OUTPUT_LIMIT", "TOOL_DAEMON_LEFT_RUNNING",
    "ACTION_DEADLINE_EXHAUSTED", "PROBE_INCONCLUSIVE", "CONTAINMENT_INCOMPLETE",
}
HANDLER_UNKNOWN_PHASES = {
    "BEFORE_SIDE_EFFECT", "AFTER_SIDE_EFFECT", "COMMIT_BOUNDARY", "PROBE", "CONTAINMENT",
}
SIDE_EFFECT_INTENT_CONTRACT = "chenyida-erp-uat-promotion-rollback-side-effect-intent/v1"
SIDE_EFFECT_RECEIPT_CONTRACT = "chenyida-erp-uat-promotion-rollback-side-effect-receipt/v2"
SIDE_EFFECT_RECOVERY_ATTEMPT_CONTRACT = \
    "chenyida-erp-uat-promotion-rollback-side-effect-recovery-attempt/v1"
PREACTIVATION_CONTENT_PROOF_CONTRACT = \
    "chenyida-erp-uat-promotion-rollback-preactivation-content-proof/v2"
PREACTIVATION_CONTENT_PROOF_NAME = "PREACTIVATION_CONTENT_PROOF"
STAGING_CONTENT_PROOF_CONTRACT = \
    "chenyida-erp-uat-promotion-rollback-staging-content-proof/v1"
STAGING_CONTENT_PROOF_NAME = "POSTGRES_PRE_SWITCH_PROOF"
POSTGRES_RESTORE_PRECONDITION_CONTRACT = \
    "chenyida-erp-uat-rollback-postgresql-restore-precondition/v1"
POSTGRES_RESTORE_PRECONDITION_PROOF_NAME = "POSTGRES_RESTORE_PRECONDITION"
SIDE_EFFECTS_BY_LABEL = {
    None: ("DATABASE_FENCE", "WRITER_STOP"),
    "PRECONDITION_RECHECK": (),
    "WRITER_CONTAINMENT": ("DATABASE_FENCE", "WRITER_STOP"),
    "POSTGRESQL_RESTORE": (
        "STAGING_DATABASE_CREATE", "LOGICAL_DUMP_RESTORE", "PRIVILEGE_RECONCILE",
        "DATABASE_SWITCH",
    ),
    "UPLOADS_RESTORE": (
        "TARGET_VOLUME_CREATE", "ARCHIVE_RESTORE", "METADATA_RECONCILE", "UTILITY_REMOVE",
    ),
    "ATTACHMENTS_RESTORE": (
        "TARGET_VOLUME_CREATE", "ARCHIVE_RESTORE", "METADATA_RECONCILE", "UTILITY_REMOVE",
    ),
    "BACKUP_STATUS_RESTORE": (
        "TARGET_VOLUME_CREATE", "ARCHIVE_RESTORE", "METADATA_RECONCILE", "UTILITY_REMOVE",
    ),
    "RUNTIME_CONFIGURATION_RESTORE": (),
    "WEB_WORKER_PREDECESSOR_ACTIVATION": (
        "DATABASE_UNSEAL", "WEB_WORKER_ACTIVATE", "RELEASE_EVIDENCE_PUBLISH",
    ),
    "PROTECTED_RESOURCE_RECHECK": (),
    "UPLOADS_CONTENT": ("PROBE_UTILITY_CREATE", "PROBE_UTILITY_REMOVE"),
    "ATTACHMENTS_CONTENT": ("PROBE_UTILITY_CREATE", "PROBE_UTILITY_REMOVE"),
    "BACKUP_STATUS_CONTENT": ("PROBE_UTILITY_CREATE", "PROBE_UTILITY_REMOVE"),
}
RECORD_LABELS = frozenset((None, *STAGES, *CHECKS))
ALL_SIDE_EFFECTS = frozenset(
    name for names in SIDE_EFFECTS_BY_LABEL.values() for name in names
)


class FixedExecutorError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def reject(code: str) -> None:
    raise FixedExecutorError(code)


def embedded_postgres_sql(encoded: str, expected_sha256: str) -> bytes:
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_EMBEDDED_SQL_INVALID"
    try:
        raw = zlib.decompress(base64.b64decode(encoded, validate=True))
    except (ValueError, zlib.error):
        reject(code)
    if not 2 <= len(raw) <= 1024 * 1024 \
            or hashlib.sha256(raw).hexdigest() != expected_sha256 \
            or not raw.endswith(b"\n") or b"\x00" in raw or b"\r" in raw:
        reject(code)
    return raw


def canonical(value: Any) -> bytes:
    try:
        return (json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
        ) + "\n").encode("utf-8", "strict")
    except (TypeError, ValueError, UnicodeError):
        reject("ROLLBACK_FIXED_EXECUTOR_JSON_INVALID")


def digest_value(value: Any) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def digest_compact_value(value: Any) -> str:
    try:
        raw = json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
        ).encode("utf-8", "strict")
    except (TypeError, ValueError, UnicodeError):
        reject("ROLLBACK_FIXED_EXECUTOR_JSON_INVALID")
    return hashlib.sha256(raw).hexdigest()


def digest_backup_file_tree(items: list[dict[str, Any]]) -> str:
    normalized = [
        {
            "path_hex": item["path_hex"],
            "bytes": item["bytes"],
            "sha256": item["sha256"],
        }
        for item in items
    ]
    try:
        raw = json.dumps(
            normalized, ensure_ascii=False, sort_keys=False,
            separators=(",", ":"), allow_nan=False,
        ).encode("utf-8", "strict")
    except (KeyError, TypeError, ValueError, UnicodeError):
        reject("ROLLBACK_FIXED_EXECUTOR_JSON_INVALID")
    return hashlib.sha256(raw).hexdigest()


def without(value: dict[str, Any], field: str) -> dict[str, Any]:
    return {key: item for key, item in value.items() if key != field}


def exact(value: Any, fields: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != fields:
        reject(code)
    return value


def strict_json(raw: bytes, code: str) -> dict[str, Any]:
    if len(raw) < 2 or len(raw) > MAX_JSON_BYTES or not raw.endswith(b"\n"):
        reject(code)
    try:
        text = raw.decode("utf-8")
        seen: list[str] = []

        def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
            value: dict[str, Any] = {}
            for key, item in items:
                if key in value:
                    reject(code)
                value[key] = item
                seen.append(key)
            return value

        def parse_integer(token: str) -> int:
            if token == "-0":
                reject(code)
            parsed = int(token, 10)
            if not -(2**53 - 1) <= parsed <= 2**53 - 1:
                reject(code)
            return parsed

        value = json.loads(
            text, object_pairs_hook=pairs, parse_int=parse_integer,
            parse_float=lambda _value: reject(code), parse_constant=lambda _value: reject(code),
        )
    except (UnicodeDecodeError, json.JSONDecodeError, FixedExecutorError):
        reject(code)
    if not isinstance(value, dict) or canonical(value) != raw:
        reject(code)
    return value


def sha256_fd(descriptor: int) -> str:
    result = hashlib.sha256()
    offset = 0
    while True:
        chunk = os.pread(descriptor, 1024 * 1024, offset)
        if not chunk:
            break
        result.update(chunk)
        offset += len(chunk)
    return result.hexdigest()


def mode_text(metadata: os.stat_result) -> str:
    return f"{stat.S_IMODE(metadata.st_mode):04o}"


def expected_volume_metadata_state_sha256(
        records: list[dict[str, Any]], policy: dict[str, Any],
) -> str:
    """Project the exact post-reconciliation metadata receipt emitted by the helper."""
    code = "ROLLBACK_FIXED_EXECUTOR_ARCHIVE_METADATA_INVALID"
    if not isinstance(records, list) or not isinstance(policy, dict):
        reject(code)
    domain = policy.get("domain")
    ownership = policy.get("ownership")
    if domain not in {"uploads", "attachments", "backup_status"} \
            or not isinstance(ownership, dict):
        reject(code)
    reader_gid = ownership.get("gid") if domain == "backup_status" else 1
    try:
        expected_policy = volume_metadata_policy(domain, reader_gid)
    except FixedExecutorError:
        reject(code)
    if policy != expected_policy:
        reject(code)
    nodes: dict[str, dict[str, Any]] = {
        ".": {"kind": "DIRECTORY", "size": 0, "content_sha256": ZERO_SHA256},
    }
    for record in records:
        if not isinstance(record, dict) or set(record) != {
            "path", "kind", "size", "uid", "gid", "mode", "mtime", "content_sha256",
        }:
            reject(code)
        path = record["path"]
        kind = record["kind"]
        if path == ".":
            if kind != "DIRECTORY":
                reject(code)
            continue
        parts = path.split("/") if isinstance(path, str) else []
        if not parts or any(not item or item in {".", ".."} for item in parts) \
                or kind not in {"FILE", "DIRECTORY"}:
            reject(code)
        for index in range(1, len(parts)):
            parent = "/".join(parts[:index])
            prior = nodes.get(parent)
            if prior is not None and prior["kind"] != "DIRECTORY":
                reject(code)
            nodes.setdefault(parent, {
                "kind": "DIRECTORY", "size": 0, "content_sha256": ZERO_SHA256,
            })
        prior = nodes.get(path)
        if prior is not None and prior["kind"] != kind:
            reject(code)
        nodes[path] = {
            "kind": kind, "size": record["size"],
            "content_sha256": record["content_sha256"],
        }
    marker = ownership.get("marker") if domain == "backup_status" else None
    if domain == "backup_status":
        marker_node = nodes.get(marker)
        if not isinstance(marker, str) or not isinstance(marker_node, dict) \
                or marker_node["kind"] != "FILE" \
                or marker_node["content_sha256"] != ownership.get("marker_sha256"):
            reject(code)
    normalized: list[dict[str, Any]] = []
    for path in sorted(nodes, key=lambda item: item.encode("utf-8")):
        node = nodes[path]
        is_directory = node["kind"] == "DIRECTORY"
        marker_file = path == marker and not is_directory
        normalized.append({
            "path_hex": path.encode("utf-8").hex(),
            "type": node["kind"],
            "uid": ownership["uid"], "gid": ownership["gid"],
            "mode": ownership["directory_mode"] if is_directory else
                ownership["marker_mode"] if marker_file else ownership["file_mode"],
            "bytes": 0 if is_directory else node["size"],
        })
    try:
        raw = json.dumps(
            normalized, ensure_ascii=False, sort_keys=False,
            separators=(",", ":"), allow_nan=False,
        ).encode("utf-8", "strict")
    except (KeyError, TypeError, ValueError, UnicodeError):
        reject(code)
    return hashlib.sha256(raw).hexdigest()


def inspect_safe_tar_gzip(
        descriptor: int, expected_sha256: str, expected_bytes: int,
        expected_entries: int, *, maximum_files: int = 250_000,
        maximum_members: int = 1_000_001,
        maximum_uncompressed_bytes: int = 50 * 1024 * 1024 * 1024,
        metadata_policy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_ARCHIVE_INVALID"
    if not isinstance(descriptor, int) or descriptor < 3 \
            or not SHA256.fullmatch(expected_sha256 or "") \
            or isinstance(expected_bytes, bool) or not isinstance(expected_bytes, int) \
            or not 1 <= expected_bytes <= 64 * 1024 * 1024 * 1024 \
            or isinstance(expected_entries, bool) or not isinstance(expected_entries, int) \
            or isinstance(maximum_files, bool) or not isinstance(maximum_files, int) \
            or not 0 <= maximum_files <= 250_000 \
            or not 0 <= expected_entries <= maximum_files \
            or isinstance(maximum_members, bool) or not isinstance(maximum_members, int) \
            or not 1 <= maximum_members <= 1_000_001 \
            or isinstance(maximum_uncompressed_bytes, bool) \
            or not isinstance(maximum_uncompressed_bytes, int) \
            or not 1 <= maximum_uncompressed_bytes <= 50 * 1024 * 1024 * 1024:
        reject(code)
    try:
        metadata = os.fstat(descriptor)
    except OSError:
        reject(code)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size != expected_bytes \
            or sha256_fd(descriptor) != expected_sha256:
        reject(code)
    records: list[dict[str, Any]] = []
    names: set[str] = set()
    kinds: dict[str, str] = {}
    parents_of_seen_entries: set[str] = set()
    root_seen = False
    file_entries = 0
    path_bytes = 0
    uncompressed_bytes = 0
    duplicate = -1
    stream = None
    archive = None
    try:
        duplicate = os.dup(descriptor)
        os.lseek(duplicate, 0, os.SEEK_SET)
        stream = os.fdopen(duplicate, "rb", closefd=True)
        duplicate = -1
        archive = tarfile.open(fileobj=stream, mode="r|gz", encoding="utf-8", errors="strict")
        for member in archive:
            if len(records) >= maximum_members or member.sparse is not None \
                    or not (member.isfile() or member.isdir()):
                reject(code)
            name = member.name
            if name.startswith("./"):
                name = name[2:]
            if name == "." and member.name == ".":
                name = ""
            if not name:
                if root_seen or not member.isdir() or member.size != 0:
                    reject(code)
                root_seen = True
                if member.uid < 0 or member.gid < 0 \
                        or member.uid > 2**31 - 1 or member.gid > 2**31 - 1 \
                        or member.mode < 0 or member.mode > 0o2777 \
                        or member.mode & 0o5000 \
                        or isinstance(member.mtime, bool) \
                        or not isinstance(member.mtime, (int, float)) \
                        or member.mtime < 0 or int(member.mtime) != member.mtime:
                    reject(code)
                records.append({
                    "path": ".", "kind": "DIRECTORY", "size": 0,
                    "uid": member.uid, "gid": member.gid,
                    "mode": f"{member.mode:04o}", "mtime": int(member.mtime),
                    "content_sha256": ZERO_SHA256,
                })
                continue
            if name.startswith("/") or "\\" in name \
                    or any(ord(character) < 32 or ord(character) == 127 for character in name):
                reject(code)
            normalized_name = name[:-1] if name.endswith("/") else name
            parts = normalized_name.split("/")
            if not parts or len(parts) > 64 or any(part in {"", ".", ".."} for part in parts):
                reject(code)
            canonical_name = "/".join(parts)
            encoded_name = canonical_name.encode("utf-8")
            path_bytes += len(encoded_name)
            if len(encoded_name) > 4096 or path_bytes > 16 * 1024 * 1024 \
                    or any(kinds.get("/".join(parts[:index])) == "FILE"
                           for index in range(1, len(parts))):
                reject(code)
            if canonical_name in names or member.uid < 0 or member.gid < 0 \
                    or member.uid > 2**31 - 1 or member.gid > 2**31 - 1 \
                    or member.mode < 0 or member.mode > 0o2777 \
                    or member.mode & 0o5000 \
                    or member.isfile() and member.mode & 0o2000 \
                    or member.isfile() and canonical_name in parents_of_seen_entries \
                    or isinstance(member.mtime, bool) or not isinstance(member.mtime, (int, float)) \
                    or member.mtime < 0 or int(member.mtime) != member.mtime:
                reject(code)
            names.add(canonical_name)
            kinds[canonical_name] = "FILE" if member.isfile() else "DIRECTORY"
            parents_of_seen_entries.update(
                "/".join(parts[:index]) for index in range(1, len(parts))
            )
            content_sha256 = ZERO_SHA256
            if member.isfile():
                file_entries += 1
                if file_entries > maximum_files:
                    reject(code)
                uncompressed_bytes += member.size
                if member.size < 0 or uncompressed_bytes > maximum_uncompressed_bytes:
                    reject(code)
                extracted = archive.extractfile(member)
                if extracted is None:
                    reject(code)
                content = hashlib.sha256()
                observed_size = 0
                while True:
                    chunk = extracted.read(1024 * 1024)
                    if not chunk:
                        break
                    observed_size += len(chunk)
                    if observed_size > member.size:
                        reject(code)
                    content.update(chunk)
                if observed_size != member.size:
                    reject(code)
                content_sha256 = content.hexdigest()
            elif member.size != 0:
                reject(code)
            records.append({
                "path": canonical_name, "kind": "FILE" if member.isfile() else "DIRECTORY",
                "size": member.size, "uid": member.uid, "gid": member.gid,
                "mode": f"{member.mode:04o}", "mtime": int(member.mtime),
                "content_sha256": content_sha256,
            })
    except (OSError, EOFError, UnicodeError, tarfile.TarError):
        reject(code)
    finally:
        if archive is not None:
            archive.close()
        if stream is not None:
            stream.close()
        elif duplicate >= 0:
            os.close(duplicate)
    if file_entries != expected_entries or sha256_fd(descriptor) != expected_sha256:
        reject(code)
    ordered = sorted(records, key=lambda item: item["path"].encode("utf-8"))
    file_tree = sorted((
        {
            "path_hex": item["path"].encode("utf-8").hex(),
            "bytes": item["size"], "sha256": item["content_sha256"],
        }
        for item in ordered if item["kind"] == "FILE"
    ), key=lambda item: item["path_hex"])
    body = {
        "schema_version": 1,
        "contract": "chenyida-erp-uat-promotion-rollback-safe-archive-inventory/v2",
        "status": "SAFE_REGULAR_FILES_AND_DIRECTORIES_ONLY",
        "source_sha256": expected_sha256, "source_bytes": expected_bytes,
        "entries": file_entries,
        "directories": sum(item["kind"] == "DIRECTORY" for item in ordered),
        "uncompressed_bytes": uncompressed_bytes,
        "file_tree_sha256": digest_backup_file_tree(file_tree),
        "records_sha256": digest_value(ordered),
        "expected_metadata_state_sha256": None if metadata_policy is None else
            expected_volume_metadata_state_sha256(ordered, metadata_policy),
    }
    return {**body, "inventory_sha256": digest_value(body)}


def parse_gnu_df_capacity(raw: bytes) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_CAPACITY_OUTPUT_INVALID"
    if not isinstance(raw, bytes) or not 2 <= len(raw) <= 64 * 1024:
        reject(code)
    try:
        lines = [line for line in raw.decode("ascii").splitlines() if line.strip()]
    except UnicodeDecodeError:
        reject(code)
    if len(lines) != 2 or lines[0].split() != ["Filesystem", "Avail", "Inodes", "IFree"]:
        reject(code)
    fields = lines[1].split()
    if len(fields) != 4 or not re.fullmatch(r"[^\s\x00]{1,4096}", fields[0]) \
            or any(re.fullmatch(r"(?:0|[1-9][0-9]{0,18})", item) is None
                   for item in fields[1:]):
        reject(code)
    available_bytes, total_inodes, available_inodes = map(int, fields[1:])
    if any(value > 2**53 - 1 for value in (
        available_bytes, total_inodes, available_inodes,
    )) or total_inodes < 1 or available_inodes > total_inodes:
        reject(code)
    return {
        "filesystem": fields[0],
        "available_bytes": available_bytes,
        "total_inodes": total_inodes,
        "available_inodes": available_inodes,
    }


def validate_volume_capacity_budget(
        observations: dict[str, dict[str, Any]],
        requirements: dict[str, dict[str, int]],
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_VOLUME_CAPACITY_INSUFFICIENT"
    domains = {"uploads", "attachments", "backup_status"}
    if not isinstance(observations, dict) or set(observations) != domains \
            or not isinstance(requirements, dict) or set(requirements) != domains:
        reject(code)
    filesystems: dict[str, dict[str, int]] = {}
    normalized_observations: dict[str, dict[str, Any]] = {}
    normalized_requirements: dict[str, dict[str, int]] = {}
    for domain in sorted(domains):
        observed = observations[domain]
        required = requirements[domain]
        if not isinstance(observed, dict) or set(observed) != {
            "filesystem", "available_bytes", "total_inodes", "available_inodes",
        } or not isinstance(required, dict) or set(required) != {
            "required_bytes", "required_inodes",
        }:
            reject(code)
        filesystem = observed.get("filesystem")
        numeric = (
            observed.get("available_bytes"), observed.get("total_inodes"),
            observed.get("available_inodes"), required.get("required_bytes"),
            required.get("required_inodes"),
        )
        if not isinstance(filesystem, str) or re.fullmatch(r"[^\s\x00]{1,4096}", filesystem) is None \
                or any(isinstance(value, bool) or not isinstance(value, int) or value < 0
                       or value > 2**53 - 1 for value in numeric) \
                or observed["total_inodes"] < 1 \
                or observed["available_inodes"] > observed["total_inodes"]:
            reject(code)
        group = filesystems.setdefault(filesystem, {
            "available_bytes": observed["available_bytes"],
            "available_inodes": observed["available_inodes"],
            "required_bytes": 0, "required_inodes": 0,
        })
        group["available_bytes"] = min(group["available_bytes"], observed["available_bytes"])
        group["available_inodes"] = min(group["available_inodes"], observed["available_inodes"])
        group["required_bytes"] += required["required_bytes"]
        group["required_inodes"] += required["required_inodes"]
        normalized_observations[domain] = dict(observed)
        normalized_requirements[domain] = dict(required)
    if any(
        group["required_bytes"] + VOLUME_CAPACITY_RESERVE_BYTES > group["available_bytes"]
        or group["required_inodes"] + VOLUME_CAPACITY_RESERVE_INODES
            > group["available_inodes"]
        for group in filesystems.values()
    ):
        reject(code)
    body = {
        "schema_version": 1,
        "contract": "chenyida-erp-uat-promotion-rollback-volume-capacity-budget/v1",
        "status": "SUFFICIENT_WITH_FIXED_RESERVE",
        "reserve_bytes_per_filesystem": VOLUME_CAPACITY_RESERVE_BYTES,
        "reserve_inodes_per_filesystem": VOLUME_CAPACITY_RESERVE_INODES,
        "observations": normalized_observations,
        "requirements": normalized_requirements,
        "filesystems": {key: filesystems[key] for key in sorted(filesystems)},
    }
    return {**body, "capacity_budget_sha256": digest_value(body)}


def parse_volume_helper_probe(raw: bytes) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_VOLUME_PROBE_INVALID"
    if not isinstance(raw, bytes) or not 64 <= len(raw) <= 4096 or not raw.endswith(b"\n"):
        reject(code)
    try:
        lines = raw.decode("ascii").splitlines()
    except UnicodeDecodeError:
        reject(code)
    expected_keys = (
        "metadata_policy_status", "entries", "uncompressed_bytes",
        "file_tree_sha256", "metadata_state_sha256",
    )
    if len(lines) != len(expected_keys):
        reject(code)
    values: dict[str, str] = {}
    for line, expected in zip(lines, expected_keys, strict=True):
        key, separator, value = line.partition("=")
        if separator != "=" or key != expected or not value:
            reject(code)
        values[key] = value
    if values["metadata_policy_status"] != "VALID" \
            or re.fullmatch(r"(?:0|[1-9][0-9]{0,5})", values["entries"]) is None \
            or re.fullmatch(r"(?:0|[1-9][0-9]{0,13})", values["uncompressed_bytes"]) is None \
            or int(values["entries"]) > 250_000 \
            or int(values["uncompressed_bytes"]) > 50 * 1024 * 1024 * 1024 \
            or not SHA256.fullmatch(values["file_tree_sha256"]) \
            or not SHA256.fullmatch(values["metadata_state_sha256"]) \
            or ZERO_SHA256 in {
                values["file_tree_sha256"], values["metadata_state_sha256"],
            }:
        reject(code)
    body = {
        "metadata_policy_status": "VALID",
        "entries": int(values["entries"]),
        "uncompressed_bytes": int(values["uncompressed_bytes"]),
        "file_tree_sha256": values["file_tree_sha256"],
        "metadata_state_sha256": values["metadata_state_sha256"],
    }
    return {**body, "volume_probe_sha256": digest_value(body)}


def volume_metadata_policy(domain: str, reader_gid: int) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_VOLUME_METADATA_POLICY_INVALID"
    if domain not in {"uploads", "attachments", "backup_status"} \
            or isinstance(reader_gid, bool) or not isinstance(reader_gid, int) \
            or not 1 <= reader_gid <= 2**31 - 1:
        reject(code)
    body: dict[str, Any] = {
        "schema_version": 1,
        "contract": "chenyida-erp-uat-promotion-rollback-volume-metadata-policy/v1",
        "domain": domain,
        "helper_contract_sha256": VOLUME_HELPER_CONTRACT_SHA256,
        "maximum_files": 250_000,
        "maximum_uncompressed_bytes": 50 * 1024 * 1024 * 1024,
    }
    if domain in {"uploads", "attachments"}:
        body["ownership"] = {
            "uid": 65532, "gid": 65532,
            "directory_mode": "0750", "file_mode": "0640",
        }
    else:
        body["ownership"] = {
            "uid": 0, "gid": reader_gid,
            "directory_mode": "2750", "file_mode": "0640",
            "marker": ".chenyida-erp-receipt-root-v2", "marker_mode": "0400",
            "marker_sha256": hashlib.sha256(
                b"chenyida-erp-receipt-root/v2\n",
            ).hexdigest(),
        }
    return {**body, "metadata_policy_sha256": digest_value(body)}


def derive_volume_restore_spec(inputs: Any, domain: str) -> dict[str, Any]:
    """Bind one volume restore only to the content-addressed execution package and plan."""
    code = "ROLLBACK_FIXED_EXECUTOR_VOLUME_RESTORE_SPEC_INVALID"
    if domain not in {"uploads", "attachments", "backup_status"}:
        reject(code)
    role = f"snapshot_{domain}"
    try:
        package = inputs.package
        plan = inputs.plan
        snapshot = package["snapshot_objects"][domain]
        source = package["sources"][role]
        manifest_source = package["sources"]["snapshot_manifest"]
        reconciliation = package["content_reconciliation"]
        file_reconciliation = reconciliation["files"][domain]
        candidate = plan["candidate"]["volumes"][domain]
        target = plan["targets"]["volumes"][domain]
        helper = validate_volume_helper_plan(plan["helpers"]["volume_restore"])
        bindings = plan["source_bindings"]
    except (KeyError, TypeError, FixedExecutorError):
        reject(code)
    if not isinstance(snapshot, dict) or set(snapshot) != {"file", "sha256", "bytes", "entries"} \
            or snapshot["file"] != f"{domain.replace('_', '-')}.tar.gz" \
            or not isinstance(source, dict) or source.get("sha256") != snapshot["sha256"] \
            or source.get("bytes") != snapshot["bytes"] \
            or not SHA256.fullmatch(snapshot.get("sha256") or "") \
            or isinstance(snapshot.get("bytes"), bool) \
            or not isinstance(snapshot.get("bytes"), int) \
            or not 1 <= snapshot["bytes"] <= 64 * 1024 * 1024 * 1024 \
            or isinstance(snapshot.get("entries"), bool) \
            or not isinstance(snapshot.get("entries"), int) \
            or not 0 <= snapshot["entries"] <= 250_000 \
            or not isinstance(file_reconciliation, dict) \
            or set(file_reconciliation) != {"tree_sha256", "entries"} \
            or file_reconciliation["entries"] != snapshot["entries"] \
            or not SHA256.fullmatch(file_reconciliation.get("tree_sha256") or "") \
            or not SHA256.fullmatch(reconciliation.get("source_reconciliation_sha256") or "") \
            or reconciliation["source_reconciliation_sha256"] \
                != package["sources"].get("snapshot_reconciliation", {}).get("sha256") \
            or bindings.get("snapshot_reconciliation_sha256") \
                != reconciliation["source_reconciliation_sha256"] \
            or not isinstance(manifest_source, dict) \
            or not SHA256.fullmatch(manifest_source.get("sha256") or "") \
            or bindings.get("snapshot_manifest_sha256") != manifest_source["sha256"] \
            or not isinstance(candidate, dict) \
            or set(candidate) != {"domain", "name", "identity_sha256"} \
            or candidate["domain"] != domain \
            or not IDENTIFIER.fullmatch(candidate.get("name") or "") \
            or not SHA256.fullmatch(candidate.get("identity_sha256") or "") \
            or not isinstance(target, dict) \
            or set(target) != {"target", "utility_container"} \
            or not IDENTIFIER.fullmatch(target.get("target") or "") \
            or not IDENTIFIER.fullmatch(target.get("utility_container") or "") \
            or target["target"] == candidate["name"]:
        reject(code)
    policy = volume_metadata_policy(domain, helper["backup_status_reader_gid"])
    body = {
        "schema_version": 1,
        "contract": "chenyida-erp-uat-promotion-rollback-volume-restore-spec/v1",
        "domain": domain, "source_role": role,
        "source_artifact_sha256": snapshot["sha256"],
        "source_artifact_bytes": snapshot["bytes"], "source_entries": snapshot["entries"],
        "source_reconciliation_sha256": reconciliation["source_reconciliation_sha256"],
        "expected_tree_sha256": file_reconciliation["tree_sha256"],
        "manifest_sha256": manifest_source["sha256"],
        "candidate_volume": candidate["name"],
        "candidate_volume_identity_sha256": candidate["identity_sha256"],
        "target_volume": target["target"], "utility_container": target["utility_container"],
        "metadata_policy_sha256": policy["metadata_policy_sha256"],
        "backup_status_reader_gid": helper["backup_status_reader_gid"],
        "runtime_plan_sha256": plan["runtime_plan_sha256"],
        "helper_image_reference": helper["image_reference"],
        "helper_image_config_digest": helper["image_config_digest"],
    }
    return {**body, "restore_spec_sha256": digest_value(body)}


def parse_tool_json(raw: bytes, code: str, maximum: int = MAX_JSON_BYTES) -> Any:
    if not isinstance(raw, bytes) or not 2 <= len(raw) <= maximum:
        reject(code)

    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                reject(code)
            result[key] = value
        return result

    try:
        return json.loads(
            raw.decode("utf-8"), object_pairs_hook=pairs,
            parse_constant=lambda _value: reject(code),
        )
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError):
        reject(code)
    raise AssertionError("unreachable")


def parse_volume_inspection(
        raw: bytes, expected_name: str, *, expected_labels: dict[str, str] | None = None,
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_VOLUME_INSPECTION_INVALID"
    if not IDENTIFIER.fullmatch(expected_name or ""):
        reject(code)
    value = parse_tool_json(raw, code)
    if not isinstance(value, dict) or set(value) != {
        "CreatedAt", "Driver", "Labels", "Mountpoint", "Name", "Options", "Scope",
    }:
        reject(code)
    name = value.get("Name")
    driver = value.get("Driver")
    scope = value.get("Scope")
    mountpoint = value.get("Mountpoint")
    created_at = value.get("CreatedAt")
    labels = value.get("Labels")
    options = value.get("Options")
    if name != expected_name or driver != "local" or scope != "local" \
            or not isinstance(mountpoint, str) or not 1 <= len(mountpoint) <= 4096 \
            or not mountpoint.startswith("/") or os.path.normpath(mountpoint) != mountpoint \
            or any(ord(character) < 32 or ord(character) == 127 for character in mountpoint) \
            or not isinstance(created_at, str) or DOCKER_CREATED_AT.fullmatch(created_at) is None \
            or labels is not None and not isinstance(labels, dict) \
            or options is not None and not isinstance(options, dict):
        reject(code)
    try:
        parsed_created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except ValueError:
        reject(code)
    if parsed_created_at.utcoffset() is None:
        reject(code)
    normalized_labels = {} if labels is None else labels
    normalized_options = {} if options is None else options
    if any(
        not isinstance(key, str) or not key or "\x00" in key
        or not isinstance(item, str) or "\x00" in item
        for mapping in (normalized_labels, normalized_options)
        for key, item in mapping.items()
    ) or normalized_options \
            or expected_labels is not None and normalized_labels != expected_labels:
        reject(code)
    projection = {
        "name": name, "driver": driver, "scope": scope,
        "mountpoint": mountpoint, "created_at": created_at,
        "labels": {key: normalized_labels[key] for key in sorted(normalized_labels)},
        "options": {key: normalized_options[key] for key in sorted(normalized_options)},
    }
    return {**projection, "identity_sha256": digest_value(projection)}


def physical_path(logical: str, filesystem_root: str) -> Path:
    return Path(logical) if filesystem_root == "/" else Path(filesystem_root) / logical.lstrip("/")


def fsync_directory(directory: Path) -> None:
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(directory, flags)
        os.fsync(descriptor)
    except OSError:
        reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_STATE_SYNC_FAILED")
    finally:
        if "descriptor" in locals():
            os.close(descriptor)


def trusted_directory(directory: Path, modes: set[int]) -> None:
    try:
        metadata = directory.lstat()
    except OSError:
        reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_STATE_INVALID")
    if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode) \
            or metadata.st_uid != 0 or metadata.st_gid != 0 \
            or stat.S_IMODE(metadata.st_mode) not in modes:
        reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_STATE_INVALID")


def ensure_directory(directory: Path, parent: Path, mode: int = 0o700) -> None:
    trusted_directory(parent, {0o700, 0o750, 0o755})
    try:
        os.mkdir(directory, mode)
        os.chown(directory, 0, 0)
        os.chmod(directory, mode)
        fsync_directory(parent)
    except FileExistsError:
        pass
    except OSError:
        reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_STATE_INVALID")
    trusted_directory(directory, {mode})


def validate_handler_event(value: Any) -> dict[str, Any]:
    event = exact(value, HANDLER_EVENT_FIELDS, "ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_INVALID")
    if event.get("schema_version") != 1 or event.get("contract") != HANDLER_STATE_CONTRACT \
            or event.get("operation") not in {"ROLLBACK_EXECUTION", "ROLLBACK_POSTVERIFY"} \
            or event.get("execution_mode") not in {"ORIGINAL", "RECOVERY"} \
            or not IDENTIFIER.fullmatch(event.get("operation_id") or "") \
            or not LABEL.fullmatch(event.get("label") or "") \
            or event.get("event") not in HANDLER_EVENTS \
            or event.get("action") not in {"PREPARE", "EXECUTE", "PROBE", "CONTAIN"} \
            or isinstance(event.get("sequence"), bool) or not isinstance(event.get("sequence"), int) \
            or not 1 <= event["sequence"] <= 1_000_000 \
            or not ISO_UTC.fullmatch(event.get("recorded_at") or ""):
        reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_INVALID")
    try:
        datetime.strptime(event["recorded_at"], "%Y-%m-%dT%H:%M:%S.%fZ")
    except ValueError:
        reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_INVALID")
    for field in (
        "idempotency_key", "request_sha256", "runtime_plan_sha256",
        "execution_package_sha256", "source_set_sha256", "transaction_intent_sha256",
        "context_sha256", "record_intent_sha256",
        "previous_result_sha256", "activation_receipt_sha256", "payload_sha256",
        "previous_event_sha256", "event_sha256",
    ):
        if not SHA256.fullmatch(event.get(field) or ""):
            reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_INVALID")
    if event.get("side_effect_name") is None:
        if event.get("side_effect_identity_sha256") is not None:
            reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_INVALID")
    elif not LABEL.fullmatch(event.get("side_effect_name") or "") \
            or not SHA256.fullmatch(event.get("side_effect_identity_sha256") or ""):
        reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_INVALID")
    payload = event.get("payload")
    if payload is not None and not isinstance(payload, dict):
        reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_INVALID")
    expected_payload = ZERO_SHA256 if payload is None else digest_value(payload)
    if event["payload_sha256"] != expected_payload \
            or digest_value(without(event, "event_sha256")) != event["event_sha256"]:
        reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_INVALID")
    return event


class HandlerJournal:
    """Root-only immutable event chain for one rollback operation and handler label."""

    def __init__(self, operation: str, operation_id: str, label: str, filesystem_root: str = "/"):
        if operation not in {"ROLLBACK_EXECUTION", "ROLLBACK_POSTVERIFY"} \
                or not IDENTIFIER.fullmatch(operation_id) or not LABEL.fullmatch(label):
            reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_STATE_INVALID")
        self.operation = operation
        self.operation_id = operation_id
        self.label = label
        self.base = physical_path(HANDLER_STATE_ROOT, filesystem_root)
        self.operation_root = self.base / operation.lower()
        self.identifier_root = self.operation_root / operation_id
        self.label_root = self.identifier_root / label.lower()
        self.events_root = self.label_root / "events"
        self.pending_root = self.label_root / "pending"

    def ensure_layout(self) -> None:
        ensure_directory(self.base, self.base.parent)
        ensure_directory(self.operation_root, self.base)
        ensure_directory(self.identifier_root, self.operation_root)
        ensure_directory(self.label_root, self.identifier_root)
        ensure_directory(self.events_root, self.label_root)
        ensure_directory(self.pending_root, self.label_root)

    @staticmethod
    def _trusted_raw(file: Path) -> bytes:
        try:
            before = file.lstat()
            flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
            descriptor = os.open(file, flags)
            opened = os.fstat(descriptor)
            raw = bytearray()
            while len(raw) <= MAX_JSON_BYTES:
                chunk = os.read(descriptor, min(64 * 1024, MAX_JSON_BYTES + 1 - len(raw)))
                if not chunk:
                    break
                raw.extend(chunk)
            after = os.fstat(descriptor)
        except OSError:
            reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_INVALID")
        finally:
            if "descriptor" in locals():
                os.close(descriptor)
        identity = lambda item: (item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns, item.st_ctime_ns)
        if not stat.S_ISREG(before.st_mode) or stat.S_ISLNK(before.st_mode) \
                or before.st_uid != 0 or before.st_gid != 0 or before.st_nlink != 1 \
                or stat.S_IMODE(before.st_mode) != 0o400 or not 2 <= before.st_size <= MAX_JSON_BYTES \
                or identity(before) != identity(opened) or identity(opened) != identity(after):
            reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_INVALID")
        return bytes(raw)

    @classmethod
    def _read_event(cls, file: Path) -> dict[str, Any]:
        raw = cls._trusted_raw(file)
        event = validate_handler_event(strict_json(raw, "ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_INVALID"))
        if raw != canonical(event):
            reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_INVALID")
        return event

    def _recover_pending(self) -> None:
        trusted_directory(self.pending_root, {0o700})
        names = sorted(os.listdir(self.pending_root))
        for name in names:
            matched = re.fullmatch(r"([0-9]{6})\.([0-9a-f]{64})\.json\.pending", name)
            if matched is None:
                reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_STATE_INVALID")
            pending = self.pending_root / name
            event = self._read_event(pending)
            if event["sequence"] != int(matched.group(1)) or event["event_sha256"] != matched.group(2):
                reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_INVALID")
            final = self.events_root / name.removesuffix(".pending")
            if final.exists():
                existing = self._read_event(final)
                if existing != event:
                    reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_INVALID")
                os.unlink(pending)
            else:
                os.rename(pending, final)
            fsync_directory(self.pending_root)
            fsync_directory(self.events_root)

    def load(self) -> list[dict[str, Any]]:
        self.ensure_layout()
        self._recover_pending()
        trusted_directory(self.events_root, {0o700})
        result: list[dict[str, Any]] = []
        for name in sorted(os.listdir(self.events_root)):
            matched = re.fullmatch(r"([0-9]{6})\.([0-9a-f]{64})\.json", name)
            if matched is None:
                reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_STATE_INVALID")
            event = self._read_event(self.events_root / name)
            expected_sequence = len(result) + 1
            expected_previous = ZERO_SHA256 if not result else result[-1]["event_sha256"]
            if event["sequence"] != expected_sequence \
                    or int(matched.group(1)) != expected_sequence \
                    or event["event_sha256"] != matched.group(2) \
                    or event["previous_event_sha256"] != expected_previous \
                    or event["operation"] != self.operation \
                    or event["operation_id"] != self.operation_id or event["label"] != self.label:
                reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_CHAIN_INVALID")
            result.append(event)
        if result:
            invariant_fields = (
                "runtime_plan_sha256", "execution_package_sha256", "source_set_sha256",
                "transaction_intent_sha256", "context_sha256", "record_intent_sha256",
                "previous_result_sha256", "activation_receipt_sha256",
            )
            baseline = result[0]
            if any(
                event[field] != baseline[field]
                for event in result[1:]
                for field in invariant_fields
            ):
                reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_CHAIN_INVALID")
        return result

    def append(
        self, request: dict[str, Any], activation_receipt_sha256: str, event_name: str,
        payload: dict[str, Any] | None, recorded_at: str, *,
        side_effect_name: str | None = None, side_effect_identity_sha256: str | None = None,
    ) -> dict[str, Any]:
        if event_name not in HANDLER_EVENTS or not SHA256.fullmatch(activation_receipt_sha256) \
                or side_effect_name is None and side_effect_identity_sha256 is not None \
                or side_effect_name is not None and (
                    not LABEL.fullmatch(side_effect_name)
                    or not SHA256.fullmatch(side_effect_identity_sha256 or "")
                ):
            reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_INVALID")
        events = self.load()
        if events:
            baseline = events[0]
            invariant_fields = (
                "runtime_plan_sha256", "execution_package_sha256", "source_set_sha256",
                "transaction_intent_sha256", "context_sha256", "record_intent_sha256",
                "previous_result_sha256",
            )
            if baseline["activation_receipt_sha256"] != activation_receipt_sha256 \
                    or any(baseline[field] != request[field] for field in invariant_fields):
                reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_BINDING_DRIFT")
        key = idempotency_key(request)
        matching = [
            item for item in events
            if item["idempotency_key"] == key and item["event"] == event_name
            and (event_name not in {
                "SIDE_EFFECT_STARTED", "SIDE_EFFECT_RECORDED",
                "SIDE_EFFECT_RECOVERY_STARTED", "READ_ONLY_PROOF_RECORDED",
            }
                 or item["side_effect_name"] == side_effect_name)
        ]
        if matching:
            if len(matching) != 1 or matching[0]["payload"] != payload \
                    or matching[0]["side_effect_name"] != side_effect_name \
                    or matching[0]["side_effect_identity_sha256"] != side_effect_identity_sha256:
                reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_IDEMPOTENCY_CONFLICT")
            return matching[0]
        sequence = len(events) + 1
        body = {
            "schema_version": 1, "contract": HANDLER_STATE_CONTRACT,
            "operation": request["operation"], "operation_id": request["operation_id"],
            "execution_mode": request["execution_mode"], "label": self.label,
            "sequence": sequence, "event": event_name, "action": request["action"],
            "idempotency_key": key, "request_sha256": request["request_sha256"],
            "runtime_plan_sha256": request["runtime_plan_sha256"],
            "execution_package_sha256": request["execution_package_sha256"],
            "source_set_sha256": request["source_set_sha256"],
            "transaction_intent_sha256": request["transaction_intent_sha256"],
            "context_sha256": request["context_sha256"],
            "record_intent_sha256": request["record_intent_sha256"],
            "previous_result_sha256": request["previous_result_sha256"],
            "activation_receipt_sha256": activation_receipt_sha256,
            "side_effect_name": side_effect_name,
            "side_effect_identity_sha256": side_effect_identity_sha256,
            "payload": payload, "payload_sha256": ZERO_SHA256 if payload is None else digest_value(payload),
            "previous_event_sha256": ZERO_SHA256 if not events else events[-1]["event_sha256"],
            "recorded_at": recorded_at,
        }
        event = validate_handler_event({**body, "event_sha256": digest_value(body)})
        stem = f"{sequence:06d}.{event['event_sha256']}.json"
        pending = self.pending_root / f"{stem}.pending"
        final = self.events_root / stem
        raw = canonical(event)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(pending, flags, 0o600)
            written = 0
            while written < len(raw):
                written += os.write(descriptor, raw[written:])
            os.fchown(descriptor, 0, 0)
            os.fchmod(descriptor, 0o400)
            os.fsync(descriptor)
            os.close(descriptor)
            descriptor = -1
            fsync_directory(self.pending_root)
            os.rename(pending, final)
            fsync_directory(self.pending_root)
            fsync_directory(self.events_root)
        except OSError:
            reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_WRITE_FAILED")
        finally:
            if "descriptor" in locals() and descriptor >= 0:
                os.close(descriptor)
        stored = self._read_event(final)
        if stored != event:
            reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_INVALID")
        return stored


def create_side_effect_intent(
        request: dict[str, Any], name: str, target_identity_sha256: str,
        argv_template_sha256: str, started_at: str,
) -> dict[str, Any]:
    body = {
        "schema_version": 1, "contract": SIDE_EFFECT_INTENT_CONTRACT,
        "operation_id": request["operation_id"], "label": request["label"],
        "side_effect_name": name, "runtime_plan_sha256": request["runtime_plan_sha256"],
        "source_set_sha256": request["source_set_sha256"],
        "target_identity_sha256": target_identity_sha256,
        "argv_template_sha256": argv_template_sha256, "started_at": started_at,
    }
    return {**body, "intent_sha256": digest_value(body)}


def validate_side_effect_intent(
        value: Any, request: dict[str, Any], name: str,
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_SIDE_EFFECT_INTENT_INVALID"
    item = exact(value, {
        "schema_version", "contract", "operation_id", "label", "side_effect_name",
        "runtime_plan_sha256", "source_set_sha256", "target_identity_sha256",
        "argv_template_sha256", "started_at", "intent_sha256",
    }, code)
    if item["schema_version"] != 1 or item["contract"] != SIDE_EFFECT_INTENT_CONTRACT \
            or item["operation_id"] != request["operation_id"] \
            or item["label"] != request["label"] or item["side_effect_name"] != name \
            or item["runtime_plan_sha256"] != request["runtime_plan_sha256"] \
            or item["source_set_sha256"] != request["source_set_sha256"] \
            or any(SHA256.fullmatch(item.get(field) or "") is None for field in (
                "target_identity_sha256", "argv_template_sha256", "intent_sha256",
            )) \
            or item["target_identity_sha256"] == ZERO_SHA256 \
            or item["argv_template_sha256"] == ZERO_SHA256 \
            or ISO_UTC.fullmatch(item.get("started_at") or "") is None \
            or digest_value(without(item, "intent_sha256")) != item["intent_sha256"]:
        reject(code)
    return item


def create_side_effect_receipt(
        intent: dict[str, Any], before_identity_sha256: str,
        after_identity_sha256: str, completed_at: str,
) -> dict[str, Any]:
    body = {
        "schema_version": 2, "contract": SIDE_EFFECT_RECEIPT_CONTRACT,
        "status": "COMMITTED", "operation_id": intent["operation_id"],
        "label": intent["label"], "side_effect_name": intent["side_effect_name"],
        "intent_sha256": intent["intent_sha256"],
        "before_identity_sha256": before_identity_sha256,
        "after_identity_sha256": after_identity_sha256,
        "argv_template_sha256": intent["argv_template_sha256"],
        "recovery_observation_sha256": ZERO_SHA256,
        "daemon_state": "COMPLETED_NO_UNTRACKED_PROCESS", "completed_at": completed_at,
    }
    return {**body, "receipt_sha256": digest_value(body)}


def create_recovered_side_effect_receipt(
        intent: dict[str, Any], before_identity_sha256: str,
        after_identity_sha256: str, recovery_observation_sha256: str,
        completed_at: str,
) -> dict[str, Any]:
    body = {
        "schema_version": 2, "contract": SIDE_EFFECT_RECEIPT_CONTRACT,
        "status": "RECOVERED_COMMITTED", "operation_id": intent["operation_id"],
        "label": intent["label"], "side_effect_name": intent["side_effect_name"],
        "intent_sha256": intent["intent_sha256"],
        "before_identity_sha256": before_identity_sha256,
        "after_identity_sha256": after_identity_sha256,
        "argv_template_sha256": intent["argv_template_sha256"],
        "recovery_observation_sha256": recovery_observation_sha256,
        "daemon_state": "COMPLETED_NO_UNTRACKED_PROCESS", "completed_at": completed_at,
    }
    return {**body, "receipt_sha256": digest_value(body)}


def validate_side_effect_receipt_envelope(
        value: Any,
        code: str = "ROLLBACK_FIXED_EXECUTOR_SIDE_EFFECT_RECEIPT_INVALID",
) -> dict[str, Any]:
    item = exact(value, {
        "schema_version", "contract", "status", "operation_id", "label",
        "side_effect_name", "intent_sha256", "before_identity_sha256",
        "after_identity_sha256", "argv_template_sha256", "recovery_observation_sha256",
        "daemon_state",
        "completed_at", "receipt_sha256",
    }, code)
    if item["schema_version"] != 2 or item["contract"] != SIDE_EFFECT_RECEIPT_CONTRACT \
            or item["status"] not in {"COMMITTED", "RECOVERED_COMMITTED"} \
            or not IDENTIFIER.fullmatch(item.get("operation_id") or "") \
            or item.get("label") not in RECORD_LABELS \
            or item.get("side_effect_name") not in ALL_SIDE_EFFECTS \
            or any(SHA256.fullmatch(item.get(field) or "") is None for field in (
                "intent_sha256", "argv_template_sha256",
            )) \
            or item["daemon_state"] != "COMPLETED_NO_UNTRACKED_PROCESS" \
            or any(SHA256.fullmatch(item.get(field) or "") is None for field in (
                "before_identity_sha256", "after_identity_sha256",
                "recovery_observation_sha256", "receipt_sha256",
            )) \
            or item["after_identity_sha256"] == ZERO_SHA256 \
            or item["status"] == "COMMITTED" \
            and item["recovery_observation_sha256"] != ZERO_SHA256 \
            or item["status"] == "RECOVERED_COMMITTED" \
            and item["recovery_observation_sha256"] == ZERO_SHA256 \
            or ISO_UTC.fullmatch(item.get("completed_at") or "") is None \
            or digest_value(without(item, "receipt_sha256")) != item["receipt_sha256"]:
        reject(code)
    return item


def validate_side_effect_receipt(
        value: Any, intent: dict[str, Any], request: dict[str, Any], name: str,
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_SIDE_EFFECT_RECEIPT_INVALID"
    item = validate_side_effect_receipt_envelope(value, code)
    if item["operation_id"] != request["operation_id"] \
            or item["label"] != request["label"] or item["side_effect_name"] != name \
            or item["intent_sha256"] != intent["intent_sha256"] \
            or item["argv_template_sha256"] != intent["argv_template_sha256"] \
            or item["completed_at"] < intent["started_at"]:
        reject(code)
    return item


class DurableSideEffectRecorder:
    """Persists every side-effect boundary before the backend may continue."""

    def __init__(
            self, journal: HandlerJournal, request: dict[str, Any],
            activation_receipt_sha256: str, *, clock: Any, fault: Any = None,
    ):
        self.journal = journal
        self.request = request
        self.activation_receipt_sha256 = activation_receipt_sha256
        self.clock = clock
        self.fault = fault
        self._completed = 0

    def _events(self) -> list[dict[str, Any]]:
        return [
            item for item in self.journal.load()
            if handler_binding_matches(
                item, self.request, self.activation_receipt_sha256,
            )
        ]

    def begin(self, name: str, intent: dict[str, Any]) -> dict[str, Any]:
        allowed = SIDE_EFFECTS_BY_LABEL.get(self.request["label"], ())
        expected_action = "CONTAIN" if self.request["label"] is None \
            else "EXECUTE" if self.request["operation"] == "ROLLBACK_EXECUTION" \
            else "PROBE"
        if self.request["action"] != expected_action or name not in allowed:
            reject("ROLLBACK_FIXED_EXECUTOR_SIDE_EFFECT_INTENT_INVALID")
        intent = validate_side_effect_intent(intent, self.request, name)
        events = self._events()
        started_names = [
            item["side_effect_name"] for item in events if item["event"] == "SIDE_EFFECT_STARTED"
        ]
        completed_names = [
            item["side_effect_name"] for item in events if item["event"] == "SIDE_EFFECT_RECORDED"
        ]
        if name not in started_names and (
            tuple(started_names) != tuple(completed_names)
            or len(started_names) >= len(allowed) or allowed[len(started_names)] != name
        ):
            reject("ROLLBACK_FIXED_EXECUTOR_SIDE_EFFECT_ORDER_INVALID")
        event = self.journal.append(
            self.request, self.activation_receipt_sha256, "SIDE_EFFECT_STARTED", intent,
            self.clock(), side_effect_name=name,
            side_effect_identity_sha256=digest_value(intent),
        )
        if self.fault is not None:
            self.fault(f"AFTER_SIDE_EFFECT_STARTED_{name}", self.request)
        return event

    def complete(self, name: str, receipt: dict[str, Any]) -> dict[str, Any]:
        events = self._events()
        started = [
            item for item in events
            if item["event"] == "SIDE_EFFECT_STARTED" and item["side_effect_name"] == name
        ]
        if len(started) != 1:
            reject("ROLLBACK_FIXED_EXECUTOR_SIDE_EFFECT_ORDER_INVALID")
        intent = validate_side_effect_intent(started[0]["payload"], self.request, name)
        receipt = validate_side_effect_receipt(receipt, intent, self.request, name)
        recorded = [
            item for item in events
            if item["event"] == "SIDE_EFFECT_RECORDED" and item["side_effect_name"] == name
        ]
        if recorded:
            if len(recorded) != 1 or recorded[0]["payload"] != receipt:
                reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_IDEMPOTENCY_CONFLICT")
            return recorded[0]
        event = self.journal.append(
            self.request, self.activation_receipt_sha256, "SIDE_EFFECT_RECORDED", receipt,
            self.clock(), side_effect_name=name,
            side_effect_identity_sha256=digest_value(receipt),
        )
        self._completed += 1
        if self.fault is not None:
            self.fault(f"AFTER_SIDE_EFFECT_{self._completed}", self.request)
        return event

    def receipt(self, name: str) -> dict[str, Any] | None:
        recorded = [
            item for item in self._events()
            if item["event"] == "SIDE_EFFECT_RECORDED" and item["side_effect_name"] == name
        ]
        if len(recorded) > 1:
            reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_CHAIN_INVALID")
        return None if not recorded else recorded[0]["payload"]

    def started_intent(self, name: str) -> dict[str, Any] | None:
        started = [
            item for item in self._events()
            if item["event"] == "SIDE_EFFECT_STARTED" and item["side_effect_name"] == name
        ]
        if len(started) > 1:
            reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_CHAIN_INVALID")
        return None if not started else validate_side_effect_intent(
            started[0]["payload"], self.request, name,
        )

    def begin_recovery(
            self, name: str, *, opcode: dict[str, Any],
            before_observation_sha256: str, candidate_oid: str,
    ) -> bool:
        """Reserve the sole guarded database-switch recovery attempt durably.

        Returning False means an earlier probe already reserved the attempt.  The
        caller must then stay UNKNOWN instead of issuing the mutation again.
        """
        if self.request["operation"] != "ROLLBACK_EXECUTION" \
                or self.request["action"] != "PROBE" \
                or self.request["label"] != "POSTGRESQL_RESTORE" \
                or name != "DATABASE_SWITCH" \
                or SHA256.fullmatch(before_observation_sha256 or "") is None \
                or OID.fullmatch(candidate_oid or "") is None:
            reject("ROLLBACK_FIXED_EXECUTOR_SIDE_EFFECT_RECOVERY_INVALID")
        intent = self.started_intent(name)
        if intent is None or self.receipt(name) is not None:
            reject("ROLLBACK_FIXED_EXECUTOR_SIDE_EFFECT_RECOVERY_INVALID")
        try:
            opcode_bindings = opcode["bindings"]
            opcode_projection = {
                "opcode": opcode["opcode"],
                "opcode_spec_sha256": opcode["opcode_spec_sha256"],
                "sql_sha256": opcode["sql_sha256"],
                "runner_argv_template_sha256": opcode["argv_template_sha256"],
                "guarded_state_sha256": opcode_bindings["guarded_state_sha256"],
                "opcode_before_observation_sha256":
                    opcode_bindings["before_observation_sha256"],
                "staging_content_proof_sha256":
                    opcode_bindings["staging_content_proof_sha256"],
                "staging_oid": opcode_bindings["staging_oid"],
                "candidate_oid": candidate_oid,
                "expected_switched_identity_sha256":
                    opcode_bindings["expected_switched_identity_sha256"],
            }
        except (KeyError, TypeError):
            reject("ROLLBACK_FIXED_EXECUTOR_SIDE_EFFECT_RECOVERY_INVALID")
        if opcode_projection["opcode"] != "PG_RB_GUARDED_SWITCH_V3" \
                or any(SHA256.fullmatch(opcode_projection[field] or "") is None
                       for field in (
                           "opcode_spec_sha256", "sql_sha256",
                           "runner_argv_template_sha256", "guarded_state_sha256",
                           "opcode_before_observation_sha256",
                           "staging_content_proof_sha256",
                           "expected_switched_identity_sha256",
                       )):
            reject("ROLLBACK_FIXED_EXECUTOR_SIDE_EFFECT_RECOVERY_INVALID")
        if OID.fullmatch(opcode_projection["staging_oid"] or "") is None \
                or OID.fullmatch(opcode_projection["candidate_oid"] or "") is None:
            reject("ROLLBACK_FIXED_EXECUTOR_SIDE_EFFECT_RECOVERY_INVALID")
        expected_argv = {
            "opcode": opcode_projection["opcode"],
            "opcode_spec_sha256": opcode_projection["opcode_spec_sha256"],
            "sql_sha256": opcode_projection["sql_sha256"],
            "runner_argv_template_sha256":
                opcode_projection["runner_argv_template_sha256"],
        }
        if intent["argv_template_sha256"] != digest_value(expected_argv):
            reject("ROLLBACK_FIXED_EXECUTOR_SIDE_EFFECT_RECOVERY_INVALID")
        body = {
            "schema_version": 1,
            "contract": SIDE_EFFECT_RECOVERY_ATTEMPT_CONTRACT,
            "recovery_kind": "EXACT_OLD_GUARDED_DATABASE_SWITCH_REPLAY",
            "attempt": 1,
            "operation_id": self.request["operation_id"],
            "label": self.request["label"],
            "side_effect_name": name,
            "intent_sha256": intent["intent_sha256"],
            "target_identity_sha256": intent["target_identity_sha256"],
            "argv_template_sha256": intent["argv_template_sha256"],
            **opcode_projection,
            "recovery_observation_sha256": before_observation_sha256,
        }
        payload = {**body, "recovery_attempt_sha256": digest_value(body)}
        existing = [
            item for item in self._events()
            if item["event"] == "SIDE_EFFECT_RECOVERY_STARTED"
            and item["side_effect_name"] == name
        ]
        if existing:
            prior = None if len(existing) != 1 else existing[0]["payload"]
            expected_fields = set(payload)
            if not isinstance(prior, dict) or set(prior) != expected_fields \
                    or SHA256.fullmatch(prior.get("recovery_observation_sha256") or "") is None \
                    or prior.get("recovery_attempt_sha256") \
                        != digest_value(without(prior, "recovery_attempt_sha256")) \
                    or any(
                        prior.get(field) != payload[field]
                        for field in expected_fields
                        if field not in {
                            "recovery_observation_sha256", "recovery_attempt_sha256",
                        }
                    ) \
                    or existing[0]["side_effect_identity_sha256"] \
                        != prior.get("recovery_attempt_sha256"):
                reject("ROLLBACK_FIXED_EXECUTOR_SIDE_EFFECT_RECOVERY_INVALID")
            return False
        self.journal.append(
            self.request, self.activation_receipt_sha256,
            "SIDE_EFFECT_RECOVERY_STARTED", payload, self.clock(),
            side_effect_name=name,
            side_effect_identity_sha256=payload["recovery_attempt_sha256"],
        )
        if self.fault is not None:
            self.fault(f"AFTER_SIDE_EFFECT_RECOVERY_STARTED_{name}", self.request)
        return True

    def validate_terminal_evidence(self, evidence: dict[str, Any]) -> None:
        """Bind terminal PostgreSQL evidence to the immutable side-effect chain.

        The cross-language evidence validator deliberately validates a portable
        evidence envelope.  This additional root-journal boundary prevents a
        caller from changing and re-hashing the guarded opcode, receipt, or
        intent projection before RESULT_COMMITTED is accepted or replayed.
        """
        if self.request["operation"] != "ROLLBACK_EXECUTION" \
                or self.request["label"] != "POSTGRESQL_RESTORE":
            return
        code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_TERMINAL_BINDING_INVALID"
        item = validate_handler_evidence(
            self.request["operation"], self.request["label"], evidence,
        )
        intent = self.started_intent("DATABASE_SWITCH")
        receipt = self.receipt("DATABASE_SWITCH")
        if intent is None or receipt is None or item["switch_receipt"] != receipt \
                or receipt["intent_sha256"] != intent["intent_sha256"]:
            reject(code)
        target = {
            "staging_oid": item["restored_database_oid"],
            "candidate_oid": item["snapshot_database_oid"],
            "staging_content_proof_sha256":
                item["pre_switch_content_proof_sha256"],
            "guarded_opcode_spec_sha256":
                item["guarded_switch_opcode_spec_sha256"],
            "guarded_sql_sha256": item["guarded_switch_sql_sha256"],
            "guarded_state_sha256": item["guarded_switch_state_sha256"],
            "expected_switched_identity_sha256":
                item["guarded_switch_expected_identity_sha256"],
        }
        argv = {
            "opcode": "PG_RB_GUARDED_SWITCH_V3",
            "opcode_spec_sha256": item["guarded_switch_opcode_spec_sha256"],
            "sql_sha256": item["guarded_switch_sql_sha256"],
            "runner_argv_template_sha256":
                item["guarded_switch_runner_argv_template_sha256"],
        }
        if intent["target_identity_sha256"] != digest_value(target) \
                or intent["argv_template_sha256"] != digest_value(argv):
            reject(code)
        recovery = [
            event for event in self._events()
            if event["event"] == "SIDE_EFFECT_RECOVERY_STARTED"
            and event["side_effect_name"] == "DATABASE_SWITCH"
        ]
        if len(recovery) > 1 or recovery \
                and receipt["status"] != "RECOVERED_COMMITTED":
            reject(code)
        if recovery:
            payload = recovery[0]["payload"]
            expected = {
                "operation_id": self.request["operation_id"],
                "label": "POSTGRESQL_RESTORE",
                "side_effect_name": "DATABASE_SWITCH",
                "intent_sha256": intent["intent_sha256"],
                "target_identity_sha256": intent["target_identity_sha256"],
                "argv_template_sha256": intent["argv_template_sha256"],
                "opcode": "PG_RB_GUARDED_SWITCH_V3",
                "opcode_spec_sha256": item["guarded_switch_opcode_spec_sha256"],
                "sql_sha256": item["guarded_switch_sql_sha256"],
                "runner_argv_template_sha256":
                    item["guarded_switch_runner_argv_template_sha256"],
                "guarded_state_sha256": item["guarded_switch_state_sha256"],
                "opcode_before_observation_sha256":
                    item["pre_switch_content_proof"]["after_observation_sha256"],
                "staging_content_proof_sha256":
                    item["pre_switch_content_proof_sha256"],
                "staging_oid": item["restored_database_oid"],
                "candidate_oid": item["snapshot_database_oid"],
                "expected_switched_identity_sha256":
                    item["guarded_switch_expected_identity_sha256"],
            }
            if not isinstance(payload, dict) \
                    or set(payload) != {
                        "schema_version", "contract", "recovery_kind", "attempt",
                        *expected, "recovery_observation_sha256",
                        "recovery_attempt_sha256",
                    } \
                    or payload.get("schema_version") != 1 \
                    or payload.get("contract") \
                        != SIDE_EFFECT_RECOVERY_ATTEMPT_CONTRACT \
                    or payload.get("recovery_kind") \
                        != "EXACT_OLD_GUARDED_DATABASE_SWITCH_REPLAY" \
                    or payload.get("attempt") != 1 \
                    or any(payload.get(field) != value
                           for field, value in expected.items()) \
                    or SHA256.fullmatch(
                        payload.get("recovery_observation_sha256") or "",
                    ) is None \
                    or payload.get("recovery_attempt_sha256") \
                        != digest_value(without(payload, "recovery_attempt_sha256")) \
                    or recovery[0]["side_effect_identity_sha256"] \
                        != payload["recovery_attempt_sha256"]:
                reject(code)

    def record_read_only_proof(self, name: str, payload: dict[str, Any]) -> dict[str, Any]:
        if self.request["operation"] != "ROLLBACK_EXECUTION" \
                or self.request["action"] not in {"EXECUTE", "PROBE"}:
            reject("ROLLBACK_FIXED_EXECUTOR_READ_ONLY_PROOF_INVALID")
        events = self._events()
        if name == PREACTIVATION_CONTENT_PROOF_NAME \
                and self.request["label"] == "WEB_WORKER_PREDECESSOR_ACTIVATION":
            code = "ROLLBACK_FIXED_EXECUTOR_PREACTIVATION_PROOF_INVALID"
            proof = validate_preactivation_content_proof(payload, code)
            binding_receipt = self.receipt("DATABASE_UNSEAL")
            forbidden_effect = "WEB_WORKER_ACTIVATE"
        elif name == POSTGRES_RESTORE_PRECONDITION_PROOF_NAME \
                and self.request["label"] == "POSTGRESQL_RESTORE":
            code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_RESTORE_PRECONDITION_INVALID"
            proof = validate_pg_restore_precondition_envelope(payload, code)
            proof_identity_field = "restore_precondition_sha256"
            binding_receipt = self.receipt("STAGING_DATABASE_CREATE")
            forbidden_effect = "LOGICAL_DUMP_RESTORE"
        elif name == STAGING_CONTENT_PROOF_NAME \
                and self.request["label"] == "POSTGRESQL_RESTORE":
            code = "ROLLBACK_FIXED_EXECUTOR_STAGING_CONTENT_PROOF_INVALID"
            proof = validate_staging_content_proof(payload, code)
            proof_identity_field = "proof_sha256"
            binding_receipt = self.receipt("PRIVILEGE_RECONCILE")
            forbidden_effect = "DATABASE_SWITCH"
        else:
            reject("ROLLBACK_FIXED_EXECUTOR_READ_ONLY_PROOF_INVALID")
        if name == PREACTIVATION_CONTENT_PROOF_NAME:
            proof_identity_field = "proof_sha256"
        if binding_receipt is None \
                or proof.get("binding_sha256") != binding_receipt["receipt_sha256"] \
                or any(item["event"] == "SIDE_EFFECT_STARTED"
                       and item["side_effect_name"] == forbidden_effect
                       for item in events):
            reject(code)
        existing = [
            item for item in events if item["event"] == "READ_ONLY_PROOF_RECORDED"
            and item["side_effect_name"] == name
        ]
        if existing:
            if len(existing) != 1 or existing[0]["payload"] != proof:
                reject(code)
            return proof
        event = self.journal.append(
            self.request, self.activation_receipt_sha256, "READ_ONLY_PROOF_RECORDED",
            proof, self.clock(), side_effect_name=name,
            side_effect_identity_sha256=proof[proof_identity_field],
        )
        if self.fault is not None:
            self.fault(f"AFTER_{name}_RECORDED", self.request)
        return event["payload"]

    def read_only_proof(self, name: str) -> dict[str, Any] | None:
        validators = {
            PREACTIVATION_CONTENT_PROOF_NAME: validate_preactivation_content_proof,
            POSTGRES_RESTORE_PRECONDITION_PROOF_NAME:
                validate_pg_restore_precondition_envelope,
            STAGING_CONTENT_PROOF_NAME: validate_staging_content_proof,
        }
        if name not in validators:
            reject("ROLLBACK_FIXED_EXECUTOR_READ_ONLY_PROOF_INVALID")
        events = [
            item for item in self._events()
            if item["event"] == "READ_ONLY_PROOF_RECORDED"
            and item["side_effect_name"] == name
        ]
        if len(events) > 1:
            reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_CHAIN_INVALID")
        if not events:
            return None
        return validators[name](events[0]["payload"])

    def assert_closed(self) -> str:
        events = self._events()
        allowed = SIDE_EFFECTS_BY_LABEL.get(self.request["label"], ())
        started_events = [item for item in events if item["event"] == "SIDE_EFFECT_STARTED"]
        recorded_events = [item for item in events if item["event"] == "SIDE_EFFECT_RECORDED"]
        started = tuple(item["side_effect_name"] for item in started_events)
        completed = tuple(item["side_effect_name"] for item in recorded_events)
        if started != allowed or completed != allowed \
                or len(started) != len(set(started)) or len(completed) != len(set(completed)):
            raise HandlerOutcomeUnknown(
                "SIDE_EFFECT_OUTCOME_UNKNOWN", "AFTER_SIDE_EFFECT",
                side_effects_started=bool(started),
                uncertain_action="CONTAIN" if self.request["label"] is None else "EXECUTE",
            )
        receipts = []
        for started_event, recorded_event, name in zip(
                started_events, recorded_events, allowed, strict=True):
            intent = validate_side_effect_intent(started_event["payload"], self.request, name)
            receipt = validate_side_effect_receipt(
                recorded_event["payload"], intent, self.request, name,
            )
            receipts.append(receipt["receipt_sha256"])
        return digest_value({
            "operation_id": self.request["operation_id"], "label": self.request["label"],
            "runtime_plan_sha256": self.request["runtime_plan_sha256"],
            "ordered_receipt_sha256": receipts,
        })


class HandlerOutcomeUnknown(Exception):
    """A typed boundary for an outcome that must be probed/contained, never retried blindly."""

    def __init__(
            self, reason_code: str, phase: str, *, side_effects_started: bool = False,
            uncertain_action: str | None = None,
    ):
        if reason_code not in HANDLER_UNKNOWN_REASONS or phase not in HANDLER_UNKNOWN_PHASES \
                or uncertain_action is not None \
                and uncertain_action not in {"PREPARE", "EXECUTE", "PROBE", "CONTAIN"}:
            reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_UNKNOWN_INVALID")
        super().__init__(reason_code)
        self.reason_code = reason_code
        self.phase = phase
        self.side_effects_started = side_effects_started
        self.uncertain_action = uncertain_action


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def validate_record_intent_binding(request: dict[str, Any]) -> dict[str, Any]:
    intent = request.get("payload", {}).get("record_intent")
    kind = "stage" if request.get("operation") == "ROLLBACK_EXECUTION" else "check"
    label_field = kind
    digest_field = f"{kind}_intent_sha256"
    contract = f"chenyida-erp-uat-promotion-rollback-{kind}-intent/v2"
    labels = STAGES if kind == "stage" else CHECKS
    fields = {
        "schema_version", "contract", "status", "promotion_id", "promotion_generation",
        "operation_id", "execution_authorization_sha256", "rollback_plan_sha256",
        "execution_package_sha256", "runtime_plan_sha256", "ordinal", label_field,
        "previous_result_sha256", "input_sha256", "prepared_at", digest_field,
    }
    intent = exact(intent, fields, "ROLLBACK_FIXED_EXECUTOR_RECORD_INTENT_INVALID")
    ordinal = intent.get("ordinal")
    if intent.get("schema_version") != 2 or intent.get("contract") != contract \
            or intent.get("status") != "PREPARED" \
            or not IDENTIFIER.fullmatch(intent.get("promotion_id") or "") \
            or not IDENTIFIER.fullmatch(intent.get("operation_id") or "") \
            or isinstance(intent.get("promotion_generation"), bool) \
            or not isinstance(intent.get("promotion_generation"), int) \
            or not 1 <= intent["promotion_generation"] <= 1_000_000 \
            or isinstance(ordinal, bool) or not isinstance(ordinal, int) \
            or not 1 <= ordinal <= len(labels) or intent.get(label_field) != labels[ordinal - 1] \
            or intent.get(label_field) != request.get("label") \
            or intent.get("operation_id") != request.get("operation_id") \
            or intent.get("execution_package_sha256") != request.get("execution_package_sha256") \
            or intent.get("runtime_plan_sha256") != request.get("runtime_plan_sha256") \
            or intent.get("previous_result_sha256") != request.get("previous_result_sha256") \
            or not ISO_UTC.fullmatch(intent.get("prepared_at") or ""):
        reject("ROLLBACK_FIXED_EXECUTOR_RECORD_INTENT_INVALID")
    for field in (
        "execution_authorization_sha256", "rollback_plan_sha256", "execution_package_sha256",
        "runtime_plan_sha256", "previous_result_sha256", "input_sha256", digest_field,
    ):
        if not SHA256.fullmatch(intent.get(field) or ""):
            reject("ROLLBACK_FIXED_EXECUTOR_RECORD_INTENT_INVALID")
    if intent[digest_field] != request.get("record_intent_sha256") \
            or digest_value(without(intent, digest_field)) != intent[digest_field]:
        reject("ROLLBACK_FIXED_EXECUTOR_RECORD_INTENT_INVALID")
    try:
        datetime.strptime(intent["prepared_at"], "%Y-%m-%dT%H:%M:%S.%fZ")
    except ValueError:
        reject("ROLLBACK_FIXED_EXECUTOR_RECORD_INTENT_INVALID")
    return intent


def validate_handler_result_record(
        record: Any, request: dict[str, Any], intent: dict[str, Any],
        side_effect_receipts_sha256: str,
) -> dict[str, Any]:
    kind = "stage" if request["operation"] == "ROLLBACK_EXECUTION" else "check"
    label_field = kind
    intent_field = f"{kind}_intent_sha256"
    result_field = f"{kind}_result_sha256"
    expected_contract = f"chenyida-erp-uat-promotion-rollback-{kind}-result/v6"
    expected_status = "COMMITTED" if kind == "stage" else "VERIFIED"
    fields = {
        "schema_version", "contract", "status", "promotion_id", "promotion_generation",
        "operation_id", "execution_authorization_sha256", "rollback_plan_sha256",
        "execution_package_sha256", "runtime_plan_sha256", "ordinal", label_field,
        "previous_result_sha256", intent_field, "side_effect_receipts_sha256",
        "evidence", "started_at", "completed_at", result_field,
    }
    record = exact(record, fields, "ROLLBACK_FIXED_EXECUTOR_HANDLER_RESULT_INVALID")
    shared_fields = (
        "promotion_id", "promotion_generation", "operation_id", "execution_authorization_sha256",
        "rollback_plan_sha256", "execution_package_sha256", "runtime_plan_sha256", "ordinal",
        label_field, "previous_result_sha256",
    )
    if record.get("schema_version") != 6 or record.get("contract") != expected_contract \
            or record.get("status") != expected_status \
            or any(record.get(field) != intent.get(field) for field in shared_fields) \
            or record.get(intent_field) != request["record_intent_sha256"] \
            or record.get("side_effect_receipts_sha256") != side_effect_receipts_sha256 \
            or SHA256.fullmatch(record.get("side_effect_receipts_sha256") or "") is None \
            or record.get("side_effect_receipts_sha256") == ZERO_SHA256 \
            or not isinstance(record.get("evidence"), dict) \
            or not ISO_UTC.fullmatch(record.get("started_at") or "") \
            or not ISO_UTC.fullmatch(record.get("completed_at") or "") \
            or not SHA256.fullmatch(record.get(result_field) or "") \
            or digest_value(without(record, result_field)) != record[result_field]:
        reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_RESULT_INVALID")
    try:
        started = datetime.strptime(record["started_at"], "%Y-%m-%dT%H:%M:%S.%fZ")
        completed = datetime.strptime(record["completed_at"], "%Y-%m-%dT%H:%M:%S.%fZ")
    except ValueError:
        reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_RESULT_INVALID")
    if completed < started:
        reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_RESULT_INVALID")
    validate_handler_evidence(request["operation"], request["label"], record["evidence"])
    return record


def handler_binding_matches(
        event: dict[str, Any], request: dict[str, Any], activation_receipt_sha256: str,
) -> bool:
    return event["activation_receipt_sha256"] == activation_receipt_sha256 and all(
        event[field] == request[field]
        for field in (
            "runtime_plan_sha256", "execution_package_sha256", "source_set_sha256",
            "transaction_intent_sha256", "context_sha256", "record_intent_sha256",
            "previous_result_sha256",
        )
    )


def create_handler_unknown(
        request: dict[str, Any], events: list[dict[str, Any]], outcome: HandlerOutcomeUnknown,
        observed_at: str,
) -> dict[str, Any]:
    last = events[-1] if events else None
    body = {
        "schema_version": 1,
        "contract": HANDLER_UNKNOWN_CONTRACT,
        "operation": request["operation"],
        "operation_id": request["operation_id"],
        "label": request["label"],
        "request_action": request["action"],
        "uncertain_action": outcome.uncertain_action or request["action"],
        "idempotency_key": idempotency_key(request),
        "reason_code": outcome.reason_code,
        "phase": outcome.phase,
        "state_sequence": 0 if last is None else last["sequence"],
        "last_event_sha256": ZERO_SHA256 if last is None else last["event_sha256"],
        "side_effects_started": outcome.side_effects_started or any(
            item["event"] in {
                "SIDE_EFFECT_STARTED", "SIDE_EFFECT_RECORDED",
                "SIDE_EFFECT_RECOVERY_STARTED", "RESULT_COMMITTED",
            }
            for item in events
        ),
        "containment_required": True,
        "observed_at": observed_at,
    }
    return {**body, "unknown_sha256": digest_value(body)}


def create_runtime_response(
        request: dict[str, Any], manifest: dict[str, Any], status: str,
        output: dict[str, Any], started_at: str, completed_at: str,
) -> dict[str, Any]:
    body = {
        "schema_version": 1,
        "contract": RESPONSE_CONTRACT,
        "action": request["action"],
        "operation": request["operation"],
        "operation_id": request["operation_id"],
        "label": request["label"],
        "request_sha256": request["request_sha256"],
        "runtime_plan_sha256": request["runtime_plan_sha256"],
        "activation_receipt_sha256": manifest["activation"]["receipt_sha256"],
        "descriptor_manifest_sha256": manifest["manifest_sha256"],
        "handler_id": expected_handler(request),
        "idempotency_key": idempotency_key(request),
        "status": status,
        "started_at": started_at,
        "completed_at": completed_at,
        "output": output,
        "output_sha256": digest_value(output),
    }
    return {**body, "response_sha256": digest_value(body)}


class FixedHandlerEngine:
    """Durable PREPARE/EXECUTE/PROBE state machine around a closed capability backend."""

    def __init__(self, backend: Any, *, filesystem_root: str = "/", clock: Any = utc_now,
                 fault: Any = None):
        self.backend = backend
        self.filesystem_root = filesystem_root
        self.clock = clock
        self.fault = fault

    def _fault(self, point: str, request: dict[str, Any]) -> None:
        if self.fault is not None:
            self.fault(point, request)

    @staticmethod
    def _matching(
            events: list[dict[str, Any]], request: dict[str, Any], activation_sha256: str,
    ) -> list[dict[str, Any]]:
        return [
            event for event in events
            if handler_binding_matches(event, request, activation_sha256)
        ]

    def _unknown(
            self, request: dict[str, Any], manifest: dict[str, Any], journal: HandlerJournal,
            events: list[dict[str, Any]], outcome: HandlerOutcomeUnknown, started_at: str,
    ) -> dict[str, Any]:
        key = idempotency_key(request)
        existing = [
            item for item in events if item["event"] == "UNKNOWN"
            and item["idempotency_key"] == key
        ]
        if existing:
            if len(existing) != 1:
                reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_CHAIN_INVALID")
            unknown = existing[0]["payload"]
        else:
            unknown = create_handler_unknown(request, events, outcome, self.clock())
            journal.append(
                request, manifest["activation"]["receipt_sha256"], "UNKNOWN", unknown,
                unknown["observed_at"],
            )
        return create_runtime_response(
            request, manifest, "PARTIAL_OR_UNKNOWN", {"unknown": unknown},
            started_at, self.clock(),
        )

    def _operation_action(
            self, request: dict[str, Any], manifest: dict[str, Any], started_at: str,
    ) -> dict[str, Any]:
        if request["action"] in {"PREFLIGHT", "RECHECK", "PROBE"}:
            outcome = self.backend.observe(request, manifest)
        elif request["action"] == "CONTAIN":
            outcome = self.backend.contain(request, manifest, self.filesystem_root)
        else:
            reject("ROLLBACK_FIXED_EXECUTOR_DISPATCH_INVALID")
        if not isinstance(outcome, dict) or set(outcome) != {"status", "output"} \
                or not isinstance(outcome["status"], str) or not isinstance(outcome["output"], dict):
            reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_RESULT_INVALID")
        return create_runtime_response(
            request, manifest, outcome["status"], outcome["output"], started_at, self.clock(),
        )

    def dispatch(self, request: dict[str, Any], manifest: dict[str, Any]) -> dict[str, Any]:
        started_at = self.clock()
        if request["label"] is None:
            return self._operation_action(request, manifest, started_at)
        intent = validate_record_intent_binding(request)
        activation_sha256 = manifest["activation"]["receipt_sha256"]
        journal = HandlerJournal(
            request["operation"], request["operation_id"], request["label"], self.filesystem_root,
        )
        events = journal.load()
        matching = self._matching(events, request, activation_sha256)
        key = idempotency_key(request)
        same_action = [item for item in matching if item["idempotency_key"] == key]

        if request["action"] == "PREPARE":
            prepared = [item for item in same_action if item["event"] == "PREPARED"]
            if prepared:
                if len(prepared) != 1 or prepared[0]["payload"] != {"record_intent": intent}:
                    reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_IDEMPOTENCY_CONFLICT")
            else:
                try:
                    self.backend.prepare(request, manifest, matching)
                except HandlerOutcomeUnknown as outcome:
                    return self._unknown(request, manifest, journal, matching, outcome, started_at)
                prepared_event = journal.append(
                    request, activation_sha256, "PREPARED", {"record_intent": intent}, self.clock(),
                )
                self._fault("AFTER_PREPARED", request)
                prepared = [prepared_event]
            return create_runtime_response(
                request, manifest, "PREPARED", prepared[0]["payload"], started_at, self.clock(),
            )

        terminal_name = "RESULT_COMMITTED" if request["operation"] == "ROLLBACK_EXECUTION" \
            else "RESULT_VERIFIED"
        durable = [item for item in matching if item["event"] == terminal_name]
        if durable:
            durable_effects = DurableSideEffectRecorder(
                journal, request, activation_sha256, clock=self.clock,
            )
            try:
                side_effect_receipts_sha256 = durable_effects.assert_closed()
            except HandlerOutcomeUnknown:
                reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_CHAIN_INVALID")
            records = {canonical(item["payload"]["record"]) for item in durable}
            if len(records) != 1:
                reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_CHAIN_INVALID")
            record = validate_handler_result_record(
                durable[-1]["payload"]["record"], request, intent,
                side_effect_receipts_sha256,
            )
            terminal_binder = getattr(
                self.backend, "bind_terminal_evidence", None,
            )
            if callable(terminal_binder):
                terminal_binder(durable_effects, record["evidence"])
            status = "ALREADY_COMMITTED" if request["action"] == "EXECUTE" \
                else "COMMITTED" if request["operation"] == "ROLLBACK_EXECUTION" else "VERIFIED"
            return create_runtime_response(
                request, manifest, status, {"record": record}, started_at, self.clock(),
            )

        existing_unknown = [item for item in same_action if item["event"] == "UNKNOWN"]
        if existing_unknown:
            if len(existing_unknown) != 1:
                reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_CHAIN_INVALID")
            return create_runtime_response(
                request, manifest, "PARTIAL_OR_UNKNOWN",
                {"unknown": existing_unknown[0]["payload"]}, started_at, self.clock(),
            )

        if request["action"] == "EXECUTE":
            if request["operation"] != "ROLLBACK_EXECUTION":
                reject("ROLLBACK_FIXED_EXECUTOR_DISPATCH_INVALID")
            if not any(item["event"] == "PREPARED" for item in matching):
                return self._unknown(
                    request, manifest, journal, matching,
                    HandlerOutcomeUnknown("DURABLE_STATE_MISSING", "BEFORE_SIDE_EFFECT"),
                    started_at,
                )
            if any(item["event"] == "EXECUTION_STARTED" for item in matching):
                return self._unknown(
                    request, manifest, journal, matching,
                    HandlerOutcomeUnknown(
                        "SIDE_EFFECT_OUTCOME_UNKNOWN", "AFTER_SIDE_EFFECT",
                        side_effects_started=True, uncertain_action="EXECUTE",
                    ), started_at,
                )
            journal.append(request, activation_sha256, "EXECUTION_STARTED", None, self.clock())
            self._fault("AFTER_EXECUTION_STARTED", request)
            effects = DurableSideEffectRecorder(
                journal, request, activation_sha256, clock=self.clock, fault=self.fault,
            )
            try:
                outcome = self.backend.execute(request, manifest, matching, effects)
                side_effect_receipts_sha256 = effects.assert_closed()
                self._fault("AFTER_BACKEND_EXECUTE", request)
            except HandlerOutcomeUnknown as unknown:
                return self._unknown(
                    request, manifest, journal, journal.load(), unknown, started_at,
                )
        elif request["action"] == "PROBE":
            effects = DurableSideEffectRecorder(
                journal, request, activation_sha256, clock=self.clock, fault=self.fault,
            )
            try:
                outcome = self.backend.probe(request, manifest, matching, effects)
                side_effect_receipts_sha256 = effects.assert_closed()
                self._fault("AFTER_BACKEND_PROBE", request)
            except HandlerOutcomeUnknown as unknown:
                return self._unknown(
                    request, manifest, journal, journal.load(), unknown, started_at,
                )
        else:
            reject("ROLLBACK_FIXED_EXECUTOR_DISPATCH_INVALID")

        if not isinstance(outcome, dict) or set(outcome) != {"record"}:
            reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_RESULT_INVALID")
        record = validate_handler_result_record(
            outcome["record"], request, intent, side_effect_receipts_sha256,
        )
        terminal_binder = getattr(self.backend, "bind_terminal_evidence", None)
        if callable(terminal_binder):
            terminal_binder(effects, record["evidence"])
        terminal = journal.append(
            request, activation_sha256, terminal_name, {"record": record}, self.clock(),
        )
        self._fault(f"AFTER_{terminal_name}", request)
        status = "COMMITTED" if request["operation"] == "ROLLBACK_EXECUTION" else "VERIFIED"
        return create_runtime_response(
            request, manifest, status, terminal["payload"], started_at, self.clock(),
        )


def create_handler_result_record(
        request: dict[str, Any], evidence: dict[str, Any], side_effect_receipts_sha256: str,
        started_at: str, completed_at: str,
) -> dict[str, Any]:
    if SHA256.fullmatch(side_effect_receipts_sha256 or "") is None \
            or side_effect_receipts_sha256 == ZERO_SHA256:
        reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_RESULT_INVALID")
    intent = validate_record_intent_binding(request)
    kind = "stage" if request["operation"] == "ROLLBACK_EXECUTION" else "check"
    intent_field = f"{kind}_intent_sha256"
    result_field = f"{kind}_result_sha256"
    label_field = kind
    body = {
        "schema_version": 6,
        "contract": f"chenyida-erp-uat-promotion-rollback-{kind}-result/v6",
        "status": "COMMITTED" if kind == "stage" else "VERIFIED",
        **{
            field: intent[field] for field in (
                "promotion_id", "promotion_generation", "operation_id",
                "execution_authorization_sha256", "rollback_plan_sha256",
                "execution_package_sha256", "runtime_plan_sha256", "ordinal",
                label_field, "previous_result_sha256",
            )
        },
        intent_field: intent[intent_field],
        "side_effect_receipts_sha256": side_effect_receipts_sha256,
        "evidence": evidence,
        "started_at": started_at,
        "completed_at": completed_at,
    }
    return {**body, result_field: digest_value(body)}


def create_rollback_compose_overlay(plan: dict[str, Any]) -> dict[str, Any]:
    targets = plan["targets"]["volumes"]
    lines = [
        "x-chenyida-erp-rollback:",
        f"  contract: {COMPOSE_OVERLAY_CONTRACT}",
        f"  operation-id: {plan['rollback_operation_id']}",
        f"  runtime-plan-sha256: {plan['runtime_plan_sha256']}",
        "services:",
        "  web:",
        f"    image: {json.dumps(plan['predecessor']['web_image'], ensure_ascii=False)}",
        "    environment:",
        "      ERP_RUNTIME_IMAGE_REFERENCE: "
        f"{json.dumps(plan['predecessor']['web_image'], ensure_ascii=False)}",
        "      ERP_RUNTIME_IMAGE_CONFIG_DIGEST: "
        f"{json.dumps(plan['predecessor']['web_image_config_digest'], ensure_ascii=False)}",
        "    labels:",
        f"      chenyida.erp.uat-rollback-operation: {plan['rollback_operation_id']}",
        f"      chenyida.erp.uat-rollback-runtime-plan: {plan['runtime_plan_sha256']}",
        "    volumes:",
        "      - type: volume", "        source: erp_uploads",
        "        target: /data/chenyida-erp/uploads",
        "      - type: volume", "        source: erp_attachments",
        "        target: /data/chenyida-erp/attachments",
        "      - type: volume", "        source: erp_backup_status",
        "        target: /data/chenyida-erp/backup-status", "        read_only: true",
        "  worker:",
        f"    image: {json.dumps(plan['predecessor']['worker_image'], ensure_ascii=False)}",
        "    environment:",
        "      ERP_RUNTIME_IMAGE_REFERENCE: "
        f"{json.dumps(plan['predecessor']['worker_image'], ensure_ascii=False)}",
        "      ERP_RUNTIME_IMAGE_CONFIG_DIGEST: "
        f"{json.dumps(plan['predecessor']['worker_image_config_digest'], ensure_ascii=False)}",
        "    labels:",
        f"      chenyida.erp.uat-rollback-operation: {plan['rollback_operation_id']}",
        f"      chenyida.erp.uat-rollback-runtime-plan: {plan['runtime_plan_sha256']}",
        "    volumes:",
        "      - type: volume", "        source: erp_uploads",
        "        target: /data/chenyida-erp/uploads",
        "      - type: volume", "        source: erp_attachments",
        "        target: /data/chenyida-erp/attachments",
        "volumes:",
        "  erp_uploads:", "    external: true", f"    name: {targets['uploads']['target']}",
        "  erp_attachments:", "    external: true",
        f"    name: {targets['attachments']['target']}",
        "  erp_backup_status:", "    external: true",
        f"    name: {targets['backup_status']['target']}",
        "",
    ]
    content = "\n".join(lines)
    return {
        "contract": COMPOSE_OVERLAY_CONTRACT,
        "content": content,
        "compose_rollback_overlay_sha256": hashlib.sha256(content.encode()).hexdigest(),
    }


def derive_rollback_runtime_projection(plan: dict[str, Any]) -> dict[str, Any]:
    overlay = create_rollback_compose_overlay(plan)
    body = {
        "schema_version": 2,
        "contract": RUNTIME_PROJECTION_CONTRACT,
        "rollback_operation_id": plan["rollback_operation_id"],
        "runtime_plan_sha256": plan["runtime_plan_sha256"],
        "predecessor_runtime_configuration_sha256":
            plan["predecessor"]["runtime_configuration_sha256"],
        "compose_rollback_overlay_sha256": overlay["compose_rollback_overlay_sha256"],
        "database": {
            "active": plan["targets"]["database"]["active"],
            "restored_staging": plan["targets"]["database"]["staging"],
            "retained_candidate_quarantine": plan["targets"]["database"]["candidate_quarantine"],
        },
        "services": {
            "caddy": {
                "disposition": "PRESERVE_EXACT_CANDIDATE",
                "identity": plan["candidate"]["services"]["caddy"],
            },
            "postgres": {
                "disposition": "PRESERVE_EXACT_CANDIDATE",
                "identity": plan["candidate"]["services"]["postgres"],
            },
            "web": {
                "disposition": "RECREATE_FROM_PREDECESSOR_DIGEST",
                "image_reference": plan["predecessor"]["web_image"],
                "image_config_digest": plan["predecessor"]["web_image_config_digest"],
            },
            "worker": {
                "disposition": "RECREATE_FROM_PREDECESSOR_DIGEST",
                "image_reference": plan["predecessor"]["worker_image"],
                "image_config_digest": plan["predecessor"]["worker_image_config_digest"],
            },
        },
        "volumes": {
            domain: {
                "active": plan["targets"]["volumes"][domain]["target"],
                "retained_candidate": plan["candidate"]["volumes"][domain],
            }
            for domain in ("uploads", "attachments", "backup_status")
        },
        "network_disposition": "PRESERVE_EXISTING_COMPOSE_NETWORKS",
        "activation_argv_template": [
            "/proc/self/fd/{compose_plugin_fd}", "--ansi", "never", "--progress", "quiet",
            "--project-name", "chenyida-erp",
            "--project-directory", plan["deployment"]["compose_project_root"],
            "--env-file", "/proc/self/fd/{deployment_environment_fd}",
            "-f", "/proc/self/fd/{compose_fd}",
            "-f", "/proc/self/fd/{compose_release_fd}",
            "-f", "/proc/self/fd/{rollback_overlay_fd}",
            "up", "--detach", "--no-deps", "--pull", "never", "--no-build",
            "--force-recreate", "web", "worker",
        ],
    }
    return {**body, "rollback_runtime_projection_sha256": digest_value(body)}


def derive_rollback_runtime_configuration(inputs: "CapabilityInputs") -> dict[str, Any]:
    plan = inputs.plan
    projection = derive_rollback_runtime_projection(plan)
    overlay = create_rollback_compose_overlay(plan)
    predecessor = inputs.package["predecessor"]
    context = inputs.context
    body = {
        "schema_version": 1,
        "contract": "chenyida-erp-uat-promotion-rollback-runtime-configuration/v1",
        "rollback_operation_id": plan["rollback_operation_id"],
        "runtime_plan_sha256": plan["runtime_plan_sha256"],
        "rollback_runtime_projection_sha256":
            projection["rollback_runtime_projection_sha256"],
        "compose_rollback_overlay_sha256": overlay["compose_rollback_overlay_sha256"],
        "compose_file_sha256": inputs.package["sources"]["compose_file"]["sha256"],
        "compose_release_file_sha256":
            inputs.package["sources"]["compose_release_file"]["sha256"],
        "deployment_environment_sha256":
            inputs.package["sources"]["deployment_environment"]["sha256"],
        "runtime_policy_sha256": inputs.package["sources"]["runtime_policy"]["sha256"],
        "predecessor": {
            "release_manifest_sha256": predecessor["release_manifest_sha256"],
            "web_image": predecessor["web_image"],
            "web_image_config_digest": predecessor["web_image_config_digest"],
            "worker_image": predecessor["worker_image"],
            "worker_image_config_digest": predecessor["worker_image_config_digest"],
            "runtime_configuration_sha256": predecessor["runtime_configuration_sha256"],
        },
        "control": {
            "supervisor_bundle_sha256": context["supervisor_bundle_sha256"],
            "original_authorization_sha256": context["original_authorization_sha256"],
        },
        "backup_status_disposition": BACKUP_STATUS_DISPOSITION,
        "current_backup_readiness": False,
        "post_rollback_backup_required": True,
    }
    result = {**body, "rollback_runtime_configuration_sha256": digest_value(body)}
    if result["rollback_runtime_configuration_sha256"] \
            == predecessor["runtime_configuration_sha256"]:
        reject("ROLLBACK_FIXED_EXECUTOR_RUNTIME_CONFIGURATION_COLLISION")
    return result


def _evidence_strings(
        value: dict[str, Any], fields: tuple[str, ...], pattern: re.Pattern[str], code: str,
) -> None:
    if any(not isinstance(value.get(field), str)
           or pattern.fullmatch(value[field]) is None for field in fields):
        reject(code)


def _evidence_integers(
        value: dict[str, Any], fields: tuple[str, ...], minimum: int, code: str,
) -> None:
    if any(not isinstance(value.get(field), int) or isinstance(value[field], bool)
           or value[field] < minimum for field in fields):
        reject(code)


def _evidence_nonzero_digests(
        value: dict[str, Any], fields: tuple[str, ...], code: str,
) -> None:
    _evidence_strings(value, fields, SHA256, code)
    if any(value[field] == ZERO_SHA256 for field in fields):
        reject(code)


def validate_preactivation_content_proof(
        value: Any, code: str = "ROLLBACK_FIXED_EXECUTOR_PREACTIVATION_PROOF_INVALID",
) -> dict[str, Any]:
    item = exact(value, {
        "schema_version", "contract", "binding_sha256", "runtime_plan_sha256",
        "source_reconciliation_sha256", "source_database_report_sha256",
        "live_database_report_sha256", "migration_head",
        "migration_ledger_file_sha256", "migration_allowlist_sha256",
        "migration_ledger_sha256", "live_security_state_sha256",
        "active_allowed_session_role_set_sha256", "active_session_client_policy_sha256",
        "active_session_observation_sha256", "active_writer_session_count",
        "active_database_identity_sha256", "restored_database_oid",
        "restored_database_marker", "system_identifier", "active_allow_connections",
        "active_connection_limit", "active_default_transaction_read_only",
        "active_prepared_xacts", "candidate_database_quarantine_name",
        "candidate_database_quarantine_oid", "candidate_database_quarantine_marker",
        "candidate_database_quarantine_allow_connections",
        "candidate_database_quarantine_connection_limit",
        "candidate_database_quarantine_sessions",
        "candidate_database_quarantine_prepared_xacts", "before_observation_sha256",
        "after_observation_sha256", "proof_sha256",
    }, code)
    if type(item["schema_version"]) is not int or item["schema_version"] != 1 \
            or item["contract"] != PREACTIVATION_CONTENT_PROOF_CONTRACT \
            or item["source_database_report_sha256"] \
                != item["live_database_report_sha256"] \
            or item["active_writer_session_count"] != 0 \
            or item["active_allow_connections"] is not True \
            or item["active_connection_limit"] != 64 \
            or item["active_default_transaction_read_only"] is not False \
            or item["active_prepared_xacts"] != 0 \
            or item["candidate_database_quarantine_allow_connections"] is not False \
            or item["candidate_database_quarantine_connection_limit"] != 0 \
            or item["candidate_database_quarantine_sessions"] != 0 \
            or item["candidate_database_quarantine_prepared_xacts"] != 0:
        reject(code)
    digest_fields = (
        "binding_sha256", "runtime_plan_sha256", "source_reconciliation_sha256",
        "source_database_report_sha256", "live_database_report_sha256",
        "migration_ledger_file_sha256", "migration_allowlist_sha256",
        "migration_ledger_sha256",
        "live_security_state_sha256", "active_allowed_session_role_set_sha256",
        "active_session_client_policy_sha256", "active_session_observation_sha256",
        "active_database_identity_sha256", "before_observation_sha256",
        "after_observation_sha256", "proof_sha256",
    )
    _evidence_nonzero_digests(item, digest_fields, code)
    _evidence_integers(item, (
        "active_writer_session_count", "active_connection_limit", "active_prepared_xacts",
        "candidate_database_quarantine_connection_limit",
        "candidate_database_quarantine_sessions",
        "candidate_database_quarantine_prepared_xacts",
    ), 0, code)
    _evidence_strings(item, ("migration_head",), MIGRATION, code)
    _evidence_strings(item, (
        "restored_database_oid", "candidate_database_quarantine_oid",
    ), OID, code)
    _evidence_strings(item, ("system_identifier",), SYSTEM_IDENTIFIER, code)
    _evidence_strings(item, (
        "candidate_database_quarantine_name",
    ), DATABASE_IDENTIFIER, code)
    _evidence_strings(item, (
        "candidate_database_quarantine_marker",
    ), CANDIDATE_QUARANTINE_MARKER, code)
    if item["restored_database_marker"] \
            != "chenyida-erp-deployment/v2:UAT:chenyida-erp" \
            or digest_value(without(item, "proof_sha256")) != item["proof_sha256"]:
        reject(code)
    return item


def build_preactivation_content_proof(
        observed: dict[str, Any], base: dict[str, Any], binding_sha256: str,
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_PREACTIVATION_PROOF_INVALID"
    base = validate_pg_rollback_base_spec(base)
    if SHA256.fullmatch(binding_sha256 or "") is None:
        reject(code)
    try:
        active = observed["active"]
        quarantine = observed["quarantine"]
        source_report = observed["source_report"]
        live_report = observed["live_report"]
        migration = observed["migration"]
        security = observed["security"]
        sessions = observed["sessions"]
        identity = observed["identity"]
        before = observed["before"]
        after = observed["after"]
        body = {
            "schema_version": 1, "contract": PREACTIVATION_CONTENT_PROOF_CONTRACT,
            "binding_sha256": binding_sha256,
            "runtime_plan_sha256": base["runtime_plan_sha256"],
            "source_reconciliation_sha256": source_report["source_sha256"],
            "source_database_report_sha256": source_report["report_sha256"],
            "live_database_report_sha256": live_report["sha256"],
            "migration_head": migration["head"],
            "migration_ledger_file_sha256": migration["ledger_file_sha256"],
            "migration_allowlist_sha256": migration["allowlist_sha256"],
            "migration_ledger_sha256": migration["ledger_sha256"],
            "live_security_state_sha256": security["state_sha256"],
            "active_allowed_session_role_set_sha256":
                sessions["allowed_role_set_sha256"],
            "active_session_client_policy_sha256": sessions["client_policy_sha256"],
            "active_session_observation_sha256": sessions["observation_sha256"],
            "active_writer_session_count": sessions["total"],
            "active_database_identity_sha256": identity["identity_sha256"],
            "restored_database_oid": identity["oid"],
            "restored_database_marker": identity["marker"],
            "system_identifier": identity["system_identifier"],
            "active_allow_connections": active["allow_connections"],
            "active_connection_limit": active["connection_limit"],
            "active_default_transaction_read_only":
                active["default_transaction_read_only"],
            "active_prepared_xacts": active["prepared_xacts"],
            "candidate_database_quarantine_name": quarantine["name"],
            "candidate_database_quarantine_oid": quarantine["oid"],
            "candidate_database_quarantine_marker": quarantine["marker"],
            "candidate_database_quarantine_allow_connections":
                quarantine["allow_connections"],
            "candidate_database_quarantine_connection_limit":
                quarantine["connection_limit"],
            "candidate_database_quarantine_sessions": quarantine["sessions"],
            "candidate_database_quarantine_prepared_xacts": quarantine["prepared_xacts"],
            "before_observation_sha256": before["observation_sha256"],
            "after_observation_sha256": after["observation_sha256"],
        }
    except (KeyError, TypeError):
        reject(code)
    proof = validate_preactivation_content_proof({
        **body, "proof_sha256": digest_value(body),
    }, code)
    snapshot = base["snapshot"]
    databases = base["databases"]
    expected = {
        "runtime_plan_sha256": base["runtime_plan_sha256"],
        "source_reconciliation_sha256": snapshot["source_reconciliation_sha256"],
        "source_database_report_sha256": snapshot["target_database_report_sha256"],
        "live_database_report_sha256": snapshot["target_database_report_sha256"],
        "migration_head": snapshot["migration_head"],
        "migration_ledger_file_sha256": snapshot["migration_ledger_file_sha256"],
        "migration_allowlist_sha256": snapshot["migration_allowlist_sha256"],
        "restored_database_marker": databases["candidate_marker"],
        "system_identifier": base["postgres"]["system_identifier"],
        "candidate_database_quarantine_name": databases["quarantine_name"],
        "candidate_database_quarantine_oid": databases["candidate_oid"],
        "candidate_database_quarantine_marker": databases["quarantine_marker"],
    }
    if any(proof[field] != value for field, value in expected.items()) \
            or proof["restored_database_oid"] == databases["candidate_oid"]:
        reject(code)
    return proof


def validate_staging_content_proof(
        value: Any, code: str = "ROLLBACK_FIXED_EXECUTOR_STAGING_CONTENT_PROOF_INVALID",
) -> dict[str, Any]:
    item = exact(value, {
        "schema_version", "contract", "binding_sha256", "base_spec_sha256",
        "runtime_plan_sha256", "source_reconciliation_sha256",
        "source_database_report_sha256", "live_database_report_sha256",
        "migration_head", "migration_ledger_file_sha256",
        "migration_allowlist_sha256", "migration_ledger_sha256",
        "live_security_state_sha256", "staging_allowed_session_role_set_sha256",
        "staging_session_client_policy_sha256", "staging_session_observation_sha256",
        "staging_writer_session_count", "staging_database_identity_sha256",
        "staging_database_name", "staging_database_oid", "staging_database_marker",
        "system_identifier", "staging_allow_connections", "staging_connection_limit",
        "staging_default_transaction_read_only", "staging_prepared_xacts",
        "candidate_database_name", "candidate_database_oid", "candidate_database_marker",
        "candidate_database_allow_connections", "candidate_database_connection_limit",
        "candidate_database_sessions", "candidate_database_prepared_xacts",
        "before_observation_sha256", "after_observation_sha256", "proof_sha256",
    }, code)
    if type(item["schema_version"]) is not int or item["schema_version"] != 1 \
            or item["contract"] != STAGING_CONTENT_PROOF_CONTRACT \
            or item["source_database_report_sha256"] \
                != item["live_database_report_sha256"] \
            or item["staging_writer_session_count"] != 0 \
            or item["staging_allow_connections"] is not True \
            or item["staging_connection_limit"] != 0 \
            or item["staging_default_transaction_read_only"] is not True \
            or item["staging_prepared_xacts"] != 0 \
            or item["candidate_database_allow_connections"] is not False \
            or item["candidate_database_connection_limit"] != 0 \
            or item["candidate_database_sessions"] != 0 \
            or item["candidate_database_prepared_xacts"] != 0:
        reject(code)
    _evidence_integers(item, (
        "staging_writer_session_count", "staging_connection_limit",
        "staging_prepared_xacts", "candidate_database_connection_limit",
        "candidate_database_sessions", "candidate_database_prepared_xacts",
    ), 0, code)
    _evidence_nonzero_digests(item, (
        "binding_sha256", "base_spec_sha256", "runtime_plan_sha256",
        "source_reconciliation_sha256", "source_database_report_sha256",
        "live_database_report_sha256", "migration_ledger_file_sha256",
        "migration_allowlist_sha256", "migration_ledger_sha256",
        "live_security_state_sha256", "staging_allowed_session_role_set_sha256",
        "staging_session_client_policy_sha256", "staging_session_observation_sha256",
        "staging_database_identity_sha256", "before_observation_sha256",
        "after_observation_sha256", "proof_sha256",
    ), code)
    _evidence_strings(item, ("migration_head",), MIGRATION, code)
    _evidence_strings(item, ("system_identifier",), SYSTEM_IDENTIFIER, code)
    _evidence_strings(item, ("staging_database_oid", "candidate_database_oid"), OID, code)
    _evidence_strings(item, ("staging_database_name", "candidate_database_name"),
                      DATABASE_IDENTIFIER, code)
    _evidence_strings(item, ("staging_database_marker",), RESTORED_STAGING_MARKER, code)
    if item["candidate_database_marker"] \
            != "chenyida-erp-deployment/v2:UAT:chenyida-erp" \
            or item["candidate_database_name"] != "chenyida_erp" \
            or item["candidate_database_name"] == item["staging_database_name"] \
            or item["candidate_database_oid"] == item["staging_database_oid"] \
            or item["staging_database_identity_sha256"] != digest_value({
                "name": item["staging_database_name"],
                "system_identifier": item["system_identifier"],
                "oid": item["staging_database_oid"],
                "marker": item["staging_database_marker"],
            }) \
            or digest_value(without(item, "proof_sha256")) != item["proof_sha256"]:
        reject(code)
    return item


def build_staging_content_proof(
        observed: dict[str, Any], base: dict[str, Any], binding_sha256: str,
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_STAGING_CONTENT_PROOF_INVALID"
    base = validate_pg_rollback_base_spec(base)
    if SHA256.fullmatch(binding_sha256 or "") is None:
        reject(code)
    try:
        target = observed["target"]
        candidate = observed["candidate"]
        source_report = observed["source_report"]
        live_report = observed["live_report"]
        migration = observed["migration"]
        security = observed["security"]
        sessions = observed["sessions"]
        identity = observed["identity"]
        before = observed["before"]
        after = observed["after"]
        body = {
            "schema_version": 1, "contract": STAGING_CONTENT_PROOF_CONTRACT,
            "binding_sha256": binding_sha256,
            "base_spec_sha256": base["base_spec_sha256"],
            "runtime_plan_sha256": base["runtime_plan_sha256"],
            "source_reconciliation_sha256": source_report["source_sha256"],
            "source_database_report_sha256": source_report["report_sha256"],
            "live_database_report_sha256": live_report["sha256"],
            "migration_head": migration["head"],
            "migration_ledger_file_sha256": migration["ledger_file_sha256"],
            "migration_allowlist_sha256": migration["allowlist_sha256"],
            "migration_ledger_sha256": migration["ledger_sha256"],
            "live_security_state_sha256": security["state_sha256"],
            "staging_allowed_session_role_set_sha256":
                sessions["allowed_role_set_sha256"],
            "staging_session_client_policy_sha256": sessions["client_policy_sha256"],
            "staging_session_observation_sha256": sessions["observation_sha256"],
            "staging_writer_session_count": sessions["total"],
            "staging_database_identity_sha256": identity["identity_sha256"],
            "staging_database_name": identity["name"],
            "staging_database_oid": identity["oid"],
            "staging_database_marker": identity["marker"],
            "system_identifier": identity["system_identifier"],
            "staging_allow_connections": target["allow_connections"],
            "staging_connection_limit": target["connection_limit"],
            "staging_default_transaction_read_only":
                target["default_transaction_read_only"],
            "staging_prepared_xacts": target["prepared_xacts"],
            "candidate_database_name": candidate["name"],
            "candidate_database_oid": candidate["oid"],
            "candidate_database_marker": candidate["marker"],
            "candidate_database_allow_connections": candidate["allow_connections"],
            "candidate_database_connection_limit": candidate["connection_limit"],
            "candidate_database_sessions": candidate["sessions"],
            "candidate_database_prepared_xacts": candidate["prepared_xacts"],
            "before_observation_sha256": before["observation_sha256"],
            "after_observation_sha256": after["observation_sha256"],
        }
    except (KeyError, TypeError):
        reject(code)
    proof = validate_staging_content_proof({
        **body, "proof_sha256": digest_value(body),
    }, code)
    expected = {
        "base_spec_sha256": base["base_spec_sha256"],
        "runtime_plan_sha256": base["runtime_plan_sha256"],
        "source_reconciliation_sha256":
            base["snapshot"]["source_reconciliation_sha256"],
        "source_database_report_sha256":
            base["snapshot"]["target_database_report_sha256"],
        "live_database_report_sha256":
            base["snapshot"]["target_database_report_sha256"],
        "migration_head": base["snapshot"]["migration_head"],
        "migration_ledger_file_sha256":
            base["snapshot"]["migration_ledger_file_sha256"],
        "migration_allowlist_sha256":
            base["snapshot"]["migration_allowlist_sha256"],
        "staging_database_name": base["databases"]["staging_name"],
        "staging_database_marker": base["databases"]["staging_marker"],
        "system_identifier": base["postgres"]["system_identifier"],
        "candidate_database_name": base["databases"]["active_name"],
        "candidate_database_oid": base["databases"]["candidate_oid"],
        "candidate_database_marker": base["databases"]["candidate_marker"],
    }
    if any(proof[field] != expected_value for field, expected_value in expected.items()) \
            or proof["staging_database_oid"] == base["databases"]["candidate_oid"]:
        reject(code)
    return proof


def _validate_service_evidence(
        value: Any, image_field: str, image_pattern: re.Pattern[str], code: str,
) -> dict[str, Any]:
    item = exact(value, {
        "container_id", image_field, "running", "healthy", "restart_count", "oom_killed",
    }, code)
    _evidence_strings(item, ("container_id",), CONTAINER_ID, code)
    _evidence_strings(item, (image_field,), image_pattern, code)
    if item["running"] is not True or item["healthy"] is not True \
            or item["restart_count"] != 0 or item["oom_killed"] is not False:
        reject(code)
    return item


def _validate_application_service_evidence(value: Any, code: str) -> dict[str, Any]:
    item = exact(value, {
        "container_id", "image_reference", "image_config_digest", "running", "healthy",
        "restart_count", "oom_killed",
    }, code)
    _evidence_strings(item, ("container_id",), CONTAINER_ID, code)
    _evidence_strings(item, ("image_reference",), IMAGE_REFERENCE, code)
    _evidence_strings(item, ("image_config_digest",), IMAGE_DIGEST, code)
    if item["running"] is not True or item["healthy"] is not True \
            or item["restart_count"] != 0 or item["oom_killed"] is not False:
        reject(code)
    return item


def _validate_canonical_json_text(value: Any, code: str) -> dict[str, Any]:
    if not isinstance(value, str) or len(value.encode("utf-8")) > 1024 * 1024:
        reject(code)
    parsed = strict_json(value.encode("utf-8"), code)
    if canonical(parsed) != value.encode("utf-8"):
        reject(code)
    return parsed


def validate_handler_evidence(
        operation: str, label: str, evidence: Any,
) -> dict[str, Any]:
    """Mirror the exact v6 Node evidence boundary before a terminal journal event."""
    code = "ROLLBACK_FIXED_EXECUTOR_HANDLER_EVIDENCE_INVALID"
    if operation == "ROLLBACK_EXECUTION" and label not in STAGES \
            or operation == "ROLLBACK_POSTVERIFY" and label not in CHECKS:
        reject(code)
    if not isinstance(evidence, dict):
        reject(code)

    if label == "PRECONDITION_RECHECK":
        item = exact(evidence, {
            "execution_package_sha256", "source_set_sha256", "checkpoint_receipt_sha256",
            "snapshot_intent_sha256", "finalization_intent_sha256", "runtime_plan_sha256",
            "runtime_activation_sha256",
        }, code)
        _evidence_strings(item, tuple(item), SHA256, code)
    elif label == "WRITER_CONTAINMENT":
        item = exact(evidence, {
            "database_fence_sha256", "candidate_service_set_sha256", "web_container_id",
            "worker_container_id", "database_oid", "system_identifier", "stopped", "sealed",
            "runtime_plan_sha256",
        }, code)
        _evidence_strings(item, (
            "database_fence_sha256", "candidate_service_set_sha256", "runtime_plan_sha256",
        ), SHA256, code)
        _evidence_strings(item, ("web_container_id", "worker_container_id"), CONTAINER_ID, code)
        _evidence_strings(item, ("database_oid",), OID, code)
        _evidence_strings(item, ("system_identifier",), SYSTEM_IDENTIFIER, code)
        if item["stopped"] is not True or item["sealed"] is not True:
            reject(code)
    elif label == "POSTGRESQL_RESTORE":
        item = exact(evidence, {
            "strategy", "source_artifact_sha256", "source_artifact_bytes",
            "source_reconciliation_sha256", "target_content_sha256", "snapshot_database_oid",
            "restored_database_oid", "restored_database_name", "system_identifier",
            "migration_head", "restored_database_marker", "staging_database_name",
            "candidate_database_quarantine_name", "candidate_database_quarantine_oid",
            "runtime_plan_sha256", "manifest_sha256", "migration_ledger_file_sha256",
            "migration_manifest_sha256",
            "writer_containment_stage_result_sha256", "postgres_container_id",
            "postgres_image_config_digest", "database_profile_sha256",
            "postgres_base_spec_sha256", "staging_create_receipt_sha256",
            "restore_receipt_sha256", "privilege_reconcile_receipt_sha256",
            "restore_precondition_opcode_spec_sha256",
            "restore_precondition_sha256", "dump_inventory_sha256",
            "empty_projection_sha256", "restore_precondition",
            "pre_switch_content_proof_sha256", "pre_switch_content_proof",
            "runtime_privilege_access_sha256", "runtime_privilege_catalog_sha256",
            "runtime_privilege_catalog_artifact_sha256", "runtime_privilege_policy_sha256",
            "runtime_privilege_operator_policy_sha256", "uat_reconciliation_authority_sha256",
            "uat_reconciliation_activation_sha256", "sealed_security_projection_sha256",
            "staging_database_marker", "candidate_database_quarantine_marker",
            "guarded_switch_opcode_spec_sha256", "guarded_switch_sql_sha256",
            "guarded_switch_runner_argv_template_sha256",
            "guarded_switch_state_sha256", "guarded_switch_expected_identity_sha256",
            "switch_receipt_sha256", "switch_effect_identity_sha256", "switch_receipt",
            "restored_database_allow_connections_at_commit",
            "restored_database_connection_limit_at_commit",
            "restored_database_sessions_at_commit", "restored_database_prepared_xacts_at_commit",
            "candidate_database_quarantine_allow_connections_at_commit",
            "candidate_database_quarantine_connection_limit_at_commit",
            "candidate_database_quarantine_sessions_at_commit",
            "candidate_database_quarantine_prepared_xacts_at_commit",
        }, code)
        if item["strategy"] \
                != "RESTORE_TO_STAGING_DATABASE_ATOMIC_RENAME_RETAIN_CANDIDATE_QUARANTINED" \
                or item["restored_database_name"] != "chenyida_erp" \
                or item["restored_database_marker"] \
                != "chenyida-erp-deployment/v2:UAT:chenyida-erp":
            reject(code)
        _evidence_strings(item, (
            "source_artifact_sha256", "source_reconciliation_sha256", "target_content_sha256",
            "runtime_plan_sha256", "manifest_sha256", "migration_ledger_file_sha256",
            "migration_manifest_sha256",
            "writer_containment_stage_result_sha256", "database_profile_sha256",
            "postgres_base_spec_sha256", "privilege_reconcile_receipt_sha256",
            "restore_precondition_opcode_spec_sha256",
            "restore_precondition_sha256", "dump_inventory_sha256",
            "empty_projection_sha256",
            "runtime_privilege_access_sha256", "runtime_privilege_catalog_sha256",
            "runtime_privilege_catalog_artifact_sha256", "runtime_privilege_policy_sha256",
            "runtime_privilege_operator_policy_sha256", "uat_reconciliation_authority_sha256",
            "uat_reconciliation_activation_sha256", "sealed_security_projection_sha256",
            "guarded_switch_opcode_spec_sha256", "guarded_switch_sql_sha256",
            "guarded_switch_runner_argv_template_sha256",
            "guarded_switch_state_sha256", "guarded_switch_expected_identity_sha256",
            "switch_receipt_sha256", "switch_effect_identity_sha256",
            "pre_switch_content_proof_sha256",
        ), SHA256, code)
        _evidence_nonzero_digests(item, (
            "staging_create_receipt_sha256", "restore_receipt_sha256",
        ), code)
        restore_proof = validate_pg_restore_precondition_envelope(
            item["restore_precondition"], code,
        )
        staging_proof = validate_staging_content_proof(
            item["pre_switch_content_proof"], code,
        )
        switch_receipt = validate_side_effect_receipt_envelope(
            item["switch_receipt"], code,
        )
        _evidence_integers(item, ("source_artifact_bytes",), 1, code)
        _evidence_integers(item, (
            "restored_database_connection_limit_at_commit",
            "restored_database_sessions_at_commit",
            "restored_database_prepared_xacts_at_commit",
            "candidate_database_quarantine_connection_limit_at_commit",
            "candidate_database_quarantine_sessions_at_commit",
            "candidate_database_quarantine_prepared_xacts_at_commit",
        ), 0, code)
        _evidence_strings(item, (
            "snapshot_database_oid", "restored_database_oid",
            "candidate_database_quarantine_oid",
        ), OID, code)
        _evidence_strings(item, ("system_identifier",), SYSTEM_IDENTIFIER, code)
        _evidence_strings(item, ("migration_head",), MIGRATION, code)
        _evidence_strings(item, ("postgres_container_id",), CONTAINER_ID, code)
        _evidence_strings(item, ("postgres_image_config_digest",), IMAGE_DIGEST, code)
        _evidence_strings(item, ("staging_database_marker",), RESTORED_STAGING_MARKER, code)
        _evidence_strings(item, (
            "candidate_database_quarantine_marker",
        ), CANDIDATE_QUARANTINE_MARKER, code)
        _evidence_strings(item, (
            "staging_database_name", "candidate_database_quarantine_name",
        ), DATABASE_IDENTIFIER, code)
        if len({
            item["staging_database_name"], item["candidate_database_quarantine_name"],
            item["restored_database_name"],
        }) != 3 or item["candidate_database_quarantine_oid"] != item["snapshot_database_oid"] \
                or item["candidate_database_quarantine_oid"] == item["restored_database_oid"] \
                or item["pre_switch_content_proof_sha256"] \
                    != staging_proof["proof_sha256"] \
                or item["switch_receipt_sha256"] \
                    != switch_receipt["receipt_sha256"] \
                or item["switch_effect_identity_sha256"] \
                    != switch_receipt["after_identity_sha256"] \
                or switch_receipt["label"] != "POSTGRESQL_RESTORE" \
                or switch_receipt["side_effect_name"] != "DATABASE_SWITCH" \
                or switch_receipt["before_identity_sha256"] \
                    != staging_proof["proof_sha256"] \
                or switch_receipt["argv_template_sha256"] \
                    != digest_value({
                        "opcode": "PG_RB_GUARDED_SWITCH_V3",
                        "opcode_spec_sha256":
                            item["guarded_switch_opcode_spec_sha256"],
                        "sql_sha256": item["guarded_switch_sql_sha256"],
                        "runner_argv_template_sha256":
                            item["guarded_switch_runner_argv_template_sha256"],
                    }) \
                or item["guarded_switch_state_sha256"] != digest_value({
                    "source_reconciliation_sha256":
                        staging_proof["source_reconciliation_sha256"],
                    "expected_content_report_sha256":
                        staging_proof["source_database_report_sha256"],
                    "migration_ledger_file_sha256":
                        staging_proof["migration_ledger_file_sha256"],
                    "migration_allowlist_sha256":
                        staging_proof["migration_allowlist_sha256"],
                    "expected_security_state_sha256":
                        staging_proof["live_security_state_sha256"],
                    "staging_content_proof_sha256": staging_proof["proof_sha256"],
                    "staging_oid": staging_proof["staging_database_oid"],
                }) \
                or item["guarded_switch_expected_identity_sha256"] != digest_value({
                    "active_name": item["restored_database_name"],
                    "active_oid": item["restored_database_oid"],
                    "quarantine_name": item["candidate_database_quarantine_name"],
                    "quarantine_oid": item["candidate_database_quarantine_oid"],
                    "state": "NEW_SEALED",
                }) \
                or item["restore_precondition_sha256"] \
                    != restore_proof["restore_precondition_sha256"] \
                or item["restore_precondition_opcode_spec_sha256"] \
                    != restore_proof["opcode_spec_sha256"] \
                or item["dump_inventory_sha256"] \
                    != restore_proof["dump_inventory_sha256"] \
                or item["empty_projection_sha256"] \
                    != restore_proof["empty_projection_sha256"] \
                or restore_proof["base_spec_sha256"] \
                    != item["postgres_base_spec_sha256"] \
                or restore_proof["binding_sha256"] \
                    != item["staging_create_receipt_sha256"] \
                or restore_proof["create_receipt_sha256"] \
                    != item["staging_create_receipt_sha256"] \
                or restore_proof["system_identifier"] != item["system_identifier"] \
                or restore_proof["database"]["name"] \
                    != item["staging_database_name"] \
                or restore_proof["database"]["oid"] \
                    != item["restored_database_oid"] \
                or restore_proof["database"]["marker"] \
                    != item["staging_database_marker"] \
                or restore_proof["profile_sha256"] \
                    != item["database_profile_sha256"] \
                or staging_proof["binding_sha256"] \
                    != item["privilege_reconcile_receipt_sha256"] \
                or staging_proof["base_spec_sha256"] \
                    != item["postgres_base_spec_sha256"] \
                or staging_proof["runtime_plan_sha256"] \
                    != item["runtime_plan_sha256"] \
                or staging_proof["source_reconciliation_sha256"] \
                    != item["source_reconciliation_sha256"] \
                or staging_proof["source_database_report_sha256"] \
                    != item["target_content_sha256"] \
                or staging_proof["live_database_report_sha256"] \
                    != item["target_content_sha256"] \
                or staging_proof["migration_head"] != item["migration_head"] \
                or staging_proof["migration_ledger_file_sha256"] \
                    != item["migration_ledger_file_sha256"] \
                or staging_proof["migration_allowlist_sha256"] \
                    != item["migration_manifest_sha256"] \
                or staging_proof["staging_database_name"] \
                    != item["staging_database_name"] \
                or staging_proof["staging_database_oid"] \
                    != item["restored_database_oid"] \
                or staging_proof["staging_database_marker"] \
                    != item["staging_database_marker"] \
                or staging_proof["system_identifier"] != item["system_identifier"] \
                or staging_proof["candidate_database_name"] \
                    != item["restored_database_name"] \
                or staging_proof["candidate_database_oid"] \
                    != item["snapshot_database_oid"] \
                or staging_proof["candidate_database_marker"] \
                    != item["restored_database_marker"] \
                or item["restored_database_allow_connections_at_commit"] is not False \
                or item["candidate_database_quarantine_allow_connections_at_commit"] is not False \
                or any(item[field] != 0 for field in (
                    "restored_database_connection_limit_at_commit",
                    "restored_database_sessions_at_commit",
                    "restored_database_prepared_xacts_at_commit",
                    "candidate_database_quarantine_connection_limit_at_commit",
                    "candidate_database_quarantine_sessions_at_commit",
                    "candidate_database_quarantine_prepared_xacts_at_commit",
                )):
            reject(code)
    elif label in {"UPLOADS_RESTORE", "ATTACHMENTS_RESTORE", "BACKUP_STATUS_RESTORE"}:
        fields = {
            "strategy", "source_artifact_sha256", "source_artifact_bytes", "source_entries",
            "source_reconciliation_sha256", "target_content_sha256", "target_volume",
            "target_volume_identity_sha256", "retained_candidate_volume",
            "retained_candidate_volume_identity_sha256", "runtime_plan_sha256",
            "domain", "manifest_sha256", "expected_tree_sha256",
            "target_volume_marker_sha256", "target_root_identity_sha256",
            "metadata_policy_sha256", "metadata_state_sha256", "capacity_receipt_sha256",
            "volume_restore_receipt_sha256", "helper_image_reference",
            "helper_image_config_digest", "archive_inventory_sha256",
        }
        if label == "BACKUP_STATUS_RESTORE":
            fields |= {
                "backup_status_disposition", "current_backup_readiness",
                "post_rollback_backup_required",
            }
        item = exact(evidence, fields, code)
        expected_domain = {
            "UPLOADS_RESTORE": "uploads", "ATTACHMENTS_RESTORE": "attachments",
            "BACKUP_STATUS_RESTORE": "backup_status",
        }[label]
        if item["strategy"] \
                != "RESTORE_TO_NEW_NAMED_VOLUMES_RECREATE_WRITERS_RETAIN_CANDIDATE_VOLUMES":
            reject(code)
        _evidence_strings(item, (
            "source_artifact_sha256", "source_reconciliation_sha256", "target_content_sha256",
            "target_volume_identity_sha256", "retained_candidate_volume_identity_sha256",
            "runtime_plan_sha256", "manifest_sha256", "expected_tree_sha256",
            "target_volume_marker_sha256", "target_root_identity_sha256",
            "metadata_policy_sha256", "metadata_state_sha256", "archive_inventory_sha256",
        ), SHA256, code)
        _evidence_nonzero_digests(item, (
            "capacity_receipt_sha256", "volume_restore_receipt_sha256",
        ), code)
        _evidence_strings(item, ("target_volume", "retained_candidate_volume"), IDENTIFIER, code)
        _evidence_strings(item, ("helper_image_reference",), IMAGE_REFERENCE, code)
        _evidence_strings(item, ("helper_image_config_digest",), IMAGE_DIGEST, code)
        _evidence_integers(item, ("source_artifact_bytes",), 1, code)
        _evidence_integers(item, ("source_entries",), 0, code)
        if item["target_volume"] == item["retained_candidate_volume"] \
                or item["domain"] != expected_domain \
                or item["expected_tree_sha256"] != item["target_content_sha256"]:
            reject(code)
        if label == "BACKUP_STATUS_RESTORE" and (
            item["backup_status_disposition"] != BACKUP_STATUS_DISPOSITION
            or item["current_backup_readiness"] is not False
            or item["post_rollback_backup_required"] is not True
        ):
            reject(code)
    elif label == "RUNTIME_CONFIGURATION_RESTORE":
        item = exact(evidence, {
            "compose_file_sha256", "compose_release_file_sha256",
            "deployment_environment_sha256", "runtime_policy_sha256",
            "predecessor_runtime_configuration_sha256", "rollback_runtime_projection_sha256",
            "compose_rollback_overlay_sha256", "rollback_runtime_configuration_sha256",
            "runtime_plan_sha256",
        }, code)
        _evidence_strings(item, tuple(item), SHA256, code)
    elif label == "WEB_WORKER_PREDECESSOR_ACTIVATION":
        item = exact(evidence, {
            "strategy", "web", "worker", "caddy", "postgres",
            "rollback_postdeploy_receipt_sha256", "rollback_postdeploy_receipt_json",
            "release_identity_sha256", "release_identity_json",
            "predecessor_runtime_configuration_sha256", "rollback_runtime_configuration_sha256",
            "rollback_runtime_projection_sha256", "compose_rollback_overlay_sha256",
            "protected_resources_sha256", "runtime_plan_sha256",
            "uat_reconciliation_authority_sha256", "uat_reconciliation_activation_sha256",
            "sealed_security_projection_sha256", "database_unseal_receipt_sha256",
            "compose_invocation_receipt_sha256", "active_database_allow_connections",
            "active_database_connection_limit",
            "candidate_database_quarantine_allow_connections",
            "candidate_database_quarantine_connection_limit",
            "preactivation_content_proof",
        }, code)
        if item["strategy"] != "RECREATE_WEB_WORKER_FROM_PREDECESSOR_PINNED_DIGESTS":
            reject(code)
        _validate_application_service_evidence(item["web"], code)
        _validate_application_service_evidence(item["worker"], code)
        _validate_service_evidence(item["caddy"], "image_digest", IMAGE_DIGEST, code)
        _validate_service_evidence(item["postgres"], "image_digest", IMAGE_DIGEST, code)
        _evidence_strings(item, (
            "rollback_postdeploy_receipt_sha256", "release_identity_sha256",
            "predecessor_runtime_configuration_sha256", "rollback_runtime_configuration_sha256",
            "rollback_runtime_projection_sha256", "compose_rollback_overlay_sha256",
            "protected_resources_sha256", "runtime_plan_sha256",
            "uat_reconciliation_authority_sha256", "uat_reconciliation_activation_sha256",
            "sealed_security_projection_sha256",
        ), SHA256, code)
        _evidence_nonzero_digests(item, (
            "database_unseal_receipt_sha256", "compose_invocation_receipt_sha256",
        ), code)
        if item["active_database_allow_connections"] is not True \
                or item["active_database_connection_limit"] != 64 \
                or item["candidate_database_quarantine_allow_connections"] is not False \
                or item["candidate_database_quarantine_connection_limit"] != 0:
            reject(code)
        _evidence_integers(item, (
            "active_database_connection_limit",
            "candidate_database_quarantine_connection_limit",
        ), 0, code)
        validate_preactivation_content_proof(item["preactivation_content_proof"], code)
        _validate_canonical_json_text(item["rollback_postdeploy_receipt_json"], code)
        _validate_canonical_json_text(item["release_identity_json"], code)
    elif label == "PROTECTED_RESOURCE_RECHECK":
        item = exact(evidence, {
            "before_sha256", "after_sha256", "runtime_plan_sha256", "observation_sha256",
        }, code)
        _evidence_strings(item, tuple(item), SHA256, code)
        if item["before_sha256"] != item["after_sha256"]:
            reject(code)
    elif label in {
        "POSTGRESQL_CONTENT", "UPLOADS_CONTENT", "ATTACHMENTS_CONTENT",
        "BACKUP_STATUS_CONTENT",
    }:
        fields = {
            "source_artifact_sha256", "source_artifact_bytes",
            "source_reconciliation_sha256", "target_content_sha256",
            "target_identity_sha256", "stage_result_sha256", "entries",
        }
        if label == "POSTGRESQL_CONTENT":
            fields |= {
                "candidate_database_quarantine_name", "candidate_database_quarantine_oid",
                "candidate_database_quarantine_present", "runtime_plan_sha256",
                "restored_database_oid", "restored_database_marker", "system_identifier",
                "migration_head", "migration_ledger_file_sha256",
                "migration_manifest_sha256", "restore_receipt_sha256",
                "runtime_privilege_access_sha256", "runtime_privilege_catalog_sha256",
                "runtime_privilege_catalog_artifact_sha256", "runtime_privilege_policy_sha256",
                "runtime_privilege_operator_policy_sha256", "uat_reconciliation_authority_sha256",
                "uat_reconciliation_activation_sha256", "sealed_security_projection_sha256",
                "live_security_state_sha256", "active_allow_connections",
                "active_connection_limit", "active_default_transaction_read_only",
                "active_allowed_session_role_set_sha256", "active_session_observation_sha256",
                "active_session_client_policy_sha256",
                "active_writer_session_count", "active_unexpected_session_count",
                "active_prepared_xacts", "candidate_database_quarantine_marker",
                "candidate_database_quarantine_allow_connections",
                "candidate_database_quarantine_connection_limit",
                "candidate_database_quarantine_sessions",
                "candidate_database_quarantine_prepared_xacts",
            }
        else:
            fields |= {
                "candidate_volume_name", "candidate_volume_identity_sha256",
                "candidate_volume_present", "domain", "runtime_plan_sha256", "target_volume",
                "target_volume_marker_sha256", "expected_tree_sha256",
                "target_root_identity_sha256", "metadata_policy_sha256",
                "metadata_state_sha256", "volume_restore_receipt_sha256",
                "helper_image_config_digest",
            }
        if label == "BACKUP_STATUS_CONTENT":
            fields |= {
                "backup_status_disposition", "current_backup_readiness",
                "post_rollback_backup_required",
            }
        item = exact(evidence, fields, code)
        _evidence_strings(item, (
            "source_artifact_sha256", "source_reconciliation_sha256", "target_content_sha256",
            "target_identity_sha256", "stage_result_sha256",
        ), SHA256, code)
        _evidence_integers(item, ("source_artifact_bytes",), 1, code)
        if label == "POSTGRESQL_CONTENT":
            if item["entries"] is not None or item["candidate_database_quarantine_present"] is not True \
                    or item["restored_database_marker"] \
                    != "chenyida-erp-deployment/v2:UAT:chenyida-erp" \
                    or item["active_allow_connections"] is not True \
                    or item["active_connection_limit"] != 64 \
                    or item["active_default_transaction_read_only"] is not False \
                    or not isinstance(item["active_writer_session_count"], int) \
                    or isinstance(item["active_writer_session_count"], bool) \
                    or not 0 <= item["active_writer_session_count"] \
                        <= RUNTIME_WRITER_SESSION_TOTAL_MAXIMUM \
                    or item["active_unexpected_session_count"] != 0 \
                    or item["active_prepared_xacts"] != 0 \
                    or item["candidate_database_quarantine_allow_connections"] is not False \
                    or item["candidate_database_quarantine_connection_limit"] != 0 \
                    or item["candidate_database_quarantine_sessions"] != 0 \
                    or item["candidate_database_quarantine_prepared_xacts"] != 0:
                reject(code)
            _evidence_integers(item, (
                "active_connection_limit", "active_writer_session_count",
                "active_unexpected_session_count", "active_prepared_xacts",
                "candidate_database_quarantine_connection_limit",
                "candidate_database_quarantine_sessions",
                "candidate_database_quarantine_prepared_xacts",
            ), 0, code)
            _evidence_strings(item, ("candidate_database_quarantine_name",), DATABASE_IDENTIFIER, code)
            _evidence_strings(item, (
                "candidate_database_quarantine_oid", "restored_database_oid",
            ), OID, code)
            _evidence_strings(item, ("system_identifier",), SYSTEM_IDENTIFIER, code)
            _evidence_strings(item, ("migration_head",), MIGRATION, code)
            _evidence_strings(item, (
                "candidate_database_quarantine_marker",
            ), CANDIDATE_QUARANTINE_MARKER, code)
            _evidence_strings(item, (
                "runtime_plan_sha256", "migration_ledger_file_sha256",
                "migration_manifest_sha256",
                "runtime_privilege_access_sha256", "runtime_privilege_catalog_sha256",
                "runtime_privilege_catalog_artifact_sha256", "runtime_privilege_policy_sha256",
                "runtime_privilege_operator_policy_sha256", "uat_reconciliation_authority_sha256",
                "uat_reconciliation_activation_sha256", "sealed_security_projection_sha256",
                "live_security_state_sha256", "active_allowed_session_role_set_sha256",
                "active_session_observation_sha256", "active_session_client_policy_sha256",
            ), SHA256, code)
            _evidence_nonzero_digests(item, ("restore_receipt_sha256",), code)
        else:
            expected_domain = {
                "UPLOADS_CONTENT": "uploads", "ATTACHMENTS_CONTENT": "attachments",
                "BACKUP_STATUS_CONTENT": "backup_status",
            }[label]
            _evidence_integers(item, ("entries",), 0, code)
            _evidence_strings(item, ("candidate_volume_name", "target_volume"), IDENTIFIER, code)
            _evidence_strings(item, ("candidate_volume_identity_sha256",), SHA256, code)
            _evidence_strings(item, (
                "runtime_plan_sha256", "target_volume_marker_sha256", "expected_tree_sha256",
                "target_root_identity_sha256", "metadata_policy_sha256", "metadata_state_sha256",
            ), SHA256, code)
            _evidence_nonzero_digests(item, ("volume_restore_receipt_sha256",), code)
            _evidence_strings(item, ("helper_image_config_digest",), IMAGE_DIGEST, code)
            if item["candidate_volume_present"] is not True \
                    or item["domain"] != expected_domain \
                    or item["expected_tree_sha256"] != item["target_content_sha256"]:
                reject(code)
            if label == "BACKUP_STATUS_CONTENT" and (
                item["backup_status_disposition"] != BACKUP_STATUS_DISPOSITION
                or item["current_backup_readiness"] is not False
                or item["post_rollback_backup_required"] is not True
            ):
                reject(code)
    elif label == "MIGRATION_HEAD":
        item = exact(evidence, {
            "migration_head", "migration_ledger_file_sha256",
            "migration_manifest_sha256", "database_identity_sha256",
            "postgresql_stage_result_sha256",
        }, code)
        _evidence_strings(item, ("migration_head",), MIGRATION, code)
        _evidence_strings(item, (
            "migration_ledger_file_sha256", "migration_manifest_sha256",
            "database_identity_sha256",
            "postgresql_stage_result_sha256",
        ), SHA256, code)
    elif label in {"CADDY_IDENTITY", "POSTGRES_IDENTITY"}:
        item = _validate_service_evidence(evidence, "image_digest", IMAGE_DIGEST, code)
    elif label in {"WEB_IDENTITY", "WORKER_IDENTITY"}:
        item = exact(evidence, {
            "container_id", "image_reference", "image_config_digest", "application_version", "git_commit",
            "running", "healthy", "restart_count", "oom_killed",
        }, code)
        _evidence_strings(item, ("container_id",), CONTAINER_ID, code)
        _evidence_strings(item, ("image_reference",), IMAGE_REFERENCE, code)
        _evidence_strings(item, ("image_config_digest",), IMAGE_DIGEST, code)
        _evidence_strings(item, ("application_version",), VERSION, code)
        _evidence_strings(item, ("git_commit",), COMMIT, code)
        if item["running"] is not True or item["healthy"] is not True \
                or item["restart_count"] != 0 or item["oom_killed"] is not False:
            reject(code)
    elif label == "RUNTIME_CONFIGURATION":
        item = exact(evidence, {
            "predecessor_runtime_configuration_sha256", "rollback_runtime_configuration_sha256",
            "rollback_runtime_projection_sha256", "compose_rollback_overlay_sha256",
            "deployment_environment_sha256", "activation_stage_result_sha256",
            "runtime_plan_sha256",
        }, code)
        _evidence_strings(item, tuple(item), SHA256, code)
    elif label == "STRICT_RELEASE_IDENTITY":
        item = exact(evidence, {
            "release_identity_sha256", "release_manifest_sha256",
            "rollback_postdeploy_receipt_sha256", "activation_stage_result_sha256",
            "predecessor_runtime_configuration_sha256", "rollback_runtime_configuration_sha256",
        }, code)
        _evidence_strings(item, tuple(item), SHA256, code)
    elif label == "HEALTH":
        item = exact(evidence, {
            "status", "checked_at", "health_sha256", "readiness_sha256", "readiness",
            "services", "service_set_sha256", "release_identity_sha256",
            "runtime_configuration_sha256", "backup_status_disposition",
            "current_backup_readiness", "post_rollback_backup_required",
        }, code)
        if item["status"] != "HEALTHY" or not ISO_UTC.fullmatch(item["checked_at"] or "") \
                or item["backup_status_disposition"] != BACKUP_STATUS_DISPOSITION \
                or item["current_backup_readiness"] is not False \
                or item["post_rollback_backup_required"] is not True:
            reject(code)
        readiness = validate_postdeploy_readiness_document(item["readiness"], code)
        try:
            checked_at = datetime.strptime(
                item["checked_at"], "%Y-%m-%dT%H:%M:%S.%fZ",
            )
            database_time = datetime.strptime(
                readiness["database_time"], "%Y-%m-%dT%H:%M:%S.%fZ",
            )
        except ValueError:
            reject(code)
        if abs((checked_at - database_time).total_seconds()) \
                > HEALTH_DATABASE_TIME_MAX_SKEW_SECONDS:
            reject(code)
        services = exact(item["services"], {"caddy", "postgres", "web", "worker"}, code)
        _validate_service_evidence(services["caddy"], "image_digest", IMAGE_DIGEST, code)
        _validate_service_evidence(services["postgres"], "image_digest", IMAGE_DIGEST, code)
        _validate_application_service_evidence(services["web"], code)
        _validate_application_service_evidence(services["worker"], code)
        _evidence_strings(item, (
            "health_sha256", "readiness_sha256", "service_set_sha256",
            "release_identity_sha256", "runtime_configuration_sha256",
        ), SHA256, code)
        _evidence_nonzero_digests(item, (
            "health_sha256", "readiness_sha256", "service_set_sha256",
            "release_identity_sha256", "runtime_configuration_sha256",
        ), code)
        if item["readiness_sha256"] != digest_value(readiness) \
                or item["service_set_sha256"] != digest_value(services) \
                or item["health_sha256"] != digest_value(without(item, "health_sha256")):
            reject(code)
    elif label == "PROTECTED_RESOURCES":
        item = exact(evidence, {
            "before_sha256", "after_sha256", "protected_recheck_stage_result_sha256",
            "runtime_plan_sha256",
        }, code)
        _evidence_strings(item, tuple(item), SHA256, code)
        if item["before_sha256"] != item["after_sha256"]:
            reject(code)
    else:
        reject(code)
    return item


class FakeCapabilityBackend:
    """Deterministic, disconnected backend used only by fake-root handler matrix tests."""

    def __init__(self, evidence_factory: Any = None):
        self.calls: list[tuple[str, str | None]] = []
        self.results: dict[tuple[str, str, str], dict[str, Any]] = {}
        self.unknown: dict[tuple[str, str], HandlerOutcomeUnknown] = {}
        self.operation_outcomes: dict[str, dict[str, Any]] = {}
        self.evidence_factory = evidence_factory or (
            lambda label: {"fake_handler": label}
        )

    def set_unknown(self, action: str, label: str, outcome: HandlerOutcomeUnknown) -> None:
        self.unknown[(action, label)] = outcome

    def _maybe_unknown(self, action: str, label: str) -> None:
        if (action, label) in self.unknown:
            raise self.unknown[(action, label)]

    @staticmethod
    def _key(request: dict[str, Any]) -> tuple[str, str, str]:
        return request["operation"], request["operation_id"], request["label"]

    def _record(
            self, request: dict[str, Any], side_effect_receipts_sha256: str,
    ) -> dict[str, Any]:
        return create_handler_result_record(
            request, self.evidence_factory(request["label"]), side_effect_receipts_sha256,
            request["requested_at"], request["requested_at"],
        )

    def prepare(
            self, request: dict[str, Any], _manifest: dict[str, Any],
            _events: list[dict[str, Any]],
    ) -> None:
        self.calls.append(("PREPARE", request["label"]))
        self._maybe_unknown("PREPARE", request["label"])

    def execute(
            self, request: dict[str, Any], _manifest: dict[str, Any],
            _events: list[dict[str, Any]], effects: DurableSideEffectRecorder,
    ) -> dict[str, Any]:
        self.calls.append(("EXECUTE", request["label"]))
        self._maybe_unknown("EXECUTE", request["label"])
        side_effects = SIDE_EFFECTS_BY_LABEL[request["label"]]
        for side_effect_name in side_effects:
            side_effect_intent = create_side_effect_intent(
                request, side_effect_name, digest_value({
                    "backend": "DISCONNECTED_FAKE", "label": request["label"],
                    "side_effect": side_effect_name,
                }), digest_value({
                    "fake_argv": request["label"], "side_effect": side_effect_name,
                }), request["requested_at"],
            )
            effects.begin(side_effect_name, side_effect_intent)
            receipt = create_side_effect_receipt(
                side_effect_intent, ZERO_SHA256, digest_value({
                    "backend": "DISCONNECTED_FAKE", "label": request["label"],
                    "committed_side_effect": side_effect_name,
                }),
                request["requested_at"],
            )
            effects.complete(side_effect_name, receipt)
        record = self._record(request, effects.assert_closed())
        self.results[self._key(request)] = record
        return {"record": record}

    def probe(
            self, request: dict[str, Any], _manifest: dict[str, Any],
            _events: list[dict[str, Any]], _effects: DurableSideEffectRecorder,
    ) -> dict[str, Any]:
        self.calls.append(("PROBE", request["label"]))
        self._maybe_unknown("PROBE", request["label"])
        key = self._key(request)
        if request["operation"] == "ROLLBACK_POSTVERIFY":
            for side_effect_name in SIDE_EFFECTS_BY_LABEL.get(request["label"], ()):
                side_effect_intent = create_side_effect_intent(
                    request, side_effect_name, digest_value({
                        "backend": "DISCONNECTED_FAKE", "label": request["label"],
                        "side_effect": side_effect_name,
                    }), digest_value({
                        "fake_argv": request["label"], "side_effect": side_effect_name,
                    }), request["requested_at"],
                )
                _effects.begin(side_effect_name, side_effect_intent)
                receipt = create_side_effect_receipt(
                    side_effect_intent, ZERO_SHA256, digest_value({
                        "backend": "DISCONNECTED_FAKE", "label": request["label"],
                        "committed_side_effect": side_effect_name,
                    }), request["requested_at"],
                )
                _effects.complete(side_effect_name, receipt)
            self.results[key] = self._record(request, _effects.assert_closed())
        if request["operation"] == "ROLLBACK_EXECUTION" and key not in self.results:
            side_effects = SIDE_EFFECTS_BY_LABEL[request["label"]]
            if not side_effects:
                self.results[key] = self._record(request, _effects.assert_closed())
                side_effects = ()
            receipts = {
                item["side_effect_name"]: item for item in _events
                if item["event"] == "SIDE_EFFECT_RECORDED"
                and item["side_effect_name"] in side_effects
            }
            if tuple(receipts) == side_effects:
                for side_effect_name in side_effects:
                    intent = create_side_effect_intent(
                        request, side_effect_name, digest_value({
                            "backend": "DISCONNECTED_FAKE", "label": request["label"],
                            "side_effect": side_effect_name,
                        }), digest_value({
                            "fake_argv": request["label"], "side_effect": side_effect_name,
                        }), request["requested_at"],
                    )
                    expected = create_side_effect_receipt(
                        intent, ZERO_SHA256, digest_value({
                            "backend": "DISCONNECTED_FAKE", "label": request["label"],
                            "committed_side_effect": side_effect_name,
                        }),
                        request["requested_at"],
                    )
                    if receipts[side_effect_name]["payload"] != expected:
                        reject("ROLLBACK_FIXED_EXECUTOR_SIDE_EFFECT_RECEIPT_INVALID")
                self.results[key] = self._record(request, _effects.assert_closed())
        if key not in self.results:
            raise HandlerOutcomeUnknown(
                "PROBE_INCONCLUSIVE", "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            )
        return {"record": self.results[key]}

    def observe(self, request: dict[str, Any], _manifest: dict[str, Any]) -> dict[str, Any]:
        self.calls.append((request["action"], None))
        return self.operation_outcomes[request["action"]]

    def contain(
            self, request: dict[str, Any], _manifest: dict[str, Any],
            _filesystem_root: str,
    ) -> dict[str, Any]:
        self.calls.append(("CONTAIN", None))
        return self.operation_outcomes["CONTAIN"]


def read_source_bytes(
        manifest: dict[str, Any], role: str, maximum: int = MAX_JSON_BYTES,
) -> bytes:
    sources = manifest.get("sources")
    item = sources.get(role) if isinstance(sources, dict) else None
    if not isinstance(item, dict) or not isinstance(item.get("fd"), int) \
            or not isinstance(item.get("sha256"), str):
        reject("ROLLBACK_FIXED_EXECUTOR_SOURCE_FD_INVALID")
    raw = bytearray()
    offset = 0
    while len(raw) <= maximum:
        try:
            chunk = os.pread(item["fd"], min(1024 * 1024, maximum + 1 - len(raw)), offset)
        except OSError:
            reject("ROLLBACK_FIXED_EXECUTOR_SOURCE_FD_INVALID")
        if not chunk:
            break
        raw.extend(chunk)
        offset += len(chunk)
    if not raw or len(raw) > maximum or hashlib.sha256(raw).hexdigest() != item["sha256"]:
        reject("ROLLBACK_FIXED_EXECUTOR_SOURCE_FD_INVALID")
    return bytes(raw)


def validate_reconciliation_authority(
        value: Any, plan: dict[str, Any], request: dict[str, Any],
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_RECONCILIATION_AUTHORITY_INVALID"
    authority = exact(value, {
        "schema_version", "contract", "authority_id", "status", "environment",
        "promotion_id", "promotion_generation", "rollback_operation_id", "deployment_id",
        "approval_reference_sha256", "requester_identity_sha256", "approver_identity_sha256",
        "approved_at", "expires_at", "one_time", "mutation_scope", "authority_sha256",
    }, code)
    if authority.get("schema_version") != 1 \
            or authority.get("contract") \
                != "chenyida-erp-uat-promotion-rollback-reconciliation-authority/v1" \
            or authority.get("status") != "AUTHORIZED" or authority.get("environment") != "UAT" \
            or authority.get("deployment_id") != "chenyida-erp" \
            or authority.get("one_time") is not True \
            or digest_value(without(authority, "authority_sha256")) \
                != authority.get("authority_sha256"):
        reject(code)
    if not IDENTIFIER.fullmatch(authority.get("authority_id") or ""):
        reject(code)
    actors = {
        authority.get("approval_reference_sha256"),
        authority.get("requester_identity_sha256"),
        authority.get("approver_identity_sha256"),
    }
    if len(actors) != 3 or any(not SHA256.fullmatch(item or "") for item in actors):
        reject(code)
    try:
        approved = datetime.strptime(
            authority["approved_at"], "%Y-%m-%dT%H:%M:%S.%fZ",
        ).replace(tzinfo=timezone.utc)
        expires = datetime.strptime(
            authority["expires_at"], "%Y-%m-%dT%H:%M:%S.%fZ",
        ).replace(tzinfo=timezone.utc)
        requested = datetime.strptime(
            request["requested_at"], "%Y-%m-%dT%H:%M:%S.%fZ",
        ).replace(tzinfo=timezone.utc)
        action_deadline = datetime.strptime(
            request["action_deadline"], "%Y-%m-%dT%H:%M:%S.%fZ",
        ).replace(tzinfo=timezone.utc)
    except (KeyError, TypeError, ValueError):
        reject(code)
    if expires <= approved or expires - approved > timedelta(hours=24) \
            or request.get("execution_mode") == "ORIGINAL" \
                and (requested < approved or action_deadline > expires):
        reject(code)
    scope = exact(authority.get("mutation_scope"), {
        "active_database", "staging_database", "candidate_quarantine_database",
        "database_local_only", "allow_staging_database_create",
        "allow_staging_logical_restore", "allow_staging_privilege_reconcile",
        "allow_atomic_database_switch", "allow_active_database_unseal", "allow_role_create",
        "allow_role_alter", "allow_membership_change", "allow_password_change",
        "allow_tablespace_acl_change",
    }, code)
    targets = plan.get("targets", {}).get("database", {})
    if authority.get("promotion_id") != plan.get("promotion_id") \
            or authority.get("promotion_generation") != plan.get("promotion_generation") \
            or authority.get("rollback_operation_id") != request.get("operation_id") \
            or scope.get("active_database") != targets.get("active") \
            or scope.get("staging_database") != targets.get("staging") \
            or scope.get("candidate_quarantine_database") != targets.get("candidate_quarantine") \
            or any(scope.get(field) is not True for field in (
                "database_local_only", "allow_staging_database_create",
                "allow_staging_logical_restore", "allow_staging_privilege_reconcile",
                "allow_atomic_database_switch", "allow_active_database_unseal",
            )) \
            or any(scope.get(field) is not False for field in (
                "allow_role_create", "allow_role_alter", "allow_membership_change",
                "allow_password_change", "allow_tablespace_acl_change",
            )):
        reject(code)
    return authority


def validate_volume_helper_plan(
        value: Any, *, expected_supervisor_bundle_sha256: str | None = None,
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_VOLUME_HELPER_PLAN_INVALID"
    helper = exact(value, {
        "image_reference", "image_config_digest", "application_version", "git_commit",
        "git_tree", "image_role", "platform", "protocol", "contract_sha256",
        "evidence_run_id", "backup_status_reader_gid", "build_provenance_sha256",
        "sbom_evidence_sha256",
        "security_evidence_sha256",
        "supervisor_bundle_sha256",
    }, code)
    if not IMAGE_REFERENCE.fullmatch(helper.get("image_reference") or "") \
            or not IMAGE_DIGEST.fullmatch(helper.get("image_config_digest") or "") \
            or not VERSION.fullmatch(helper.get("application_version") or "") \
            or not COMMIT.fullmatch(helper.get("git_commit") or "") \
            or not COMMIT.fullmatch(helper.get("git_tree") or "") \
            or helper["git_commit"] == helper["git_tree"] \
            or helper.get("image_role") != "volume-restore-helper" \
            or helper.get("platform") != "linux/amd64" \
            or helper.get("protocol") != VOLUME_HELPER_PROTOCOL \
            or helper.get("contract_sha256") != VOLUME_HELPER_CONTRACT_SHA256 \
            or not IDENTIFIER.fullmatch(helper.get("evidence_run_id") or "") \
            or len(helper.get("evidence_run_id") or "") > 80 \
            or isinstance(helper.get("backup_status_reader_gid"), bool) \
            or not isinstance(helper.get("backup_status_reader_gid"), int) \
            or not 1 <= helper["backup_status_reader_gid"] <= 2**31 - 1 \
            or helper["image_reference"].endswith(helper["image_config_digest"][7:]):
        reject(code)
    evidence = [
        helper.get(field) for field in (
            "build_provenance_sha256", "sbom_evidence_sha256",
            "security_evidence_sha256", "supervisor_bundle_sha256",
        )
    ]
    if len(set(evidence)) != len(evidence) or any(
            not isinstance(item, str) or SHA256.fullmatch(item) is None
            or item == ZERO_SHA256 for item in evidence
    ) or expected_supervisor_bundle_sha256 is not None \
            and helper["supervisor_bundle_sha256"] != expected_supervisor_bundle_sha256:
        reject(code)
    return helper


class CapabilityInputs:
    """Lazy view of already-FD-bound package inputs; no operator path is ever reopened."""

    JSON_ROLES = {
        "snapshot_readiness", "snapshot_manifest", "snapshot_reconciliation",
        "snapshot_policy",
        "snapshot_policy_activation", "snapshot_runtime_privilege_access",
        "snapshot_runtime_privilege_compiled_catalog", "snapshot_runtime_privilege_policy",
        "snapshot_runtime_privilege_operator_policy", "predecessor_postdeploy_receipt",
        "predecessor_release_manifest", "candidate_deployment_result",
        "candidate_postdeploy_identity", "runtime_policy", "runtime_adapter_activation",
    }

    def __init__(self, request: dict[str, Any], manifest: dict[str, Any]):
        self.request = request
        self.manifest = manifest
        self.package = request["payload"]["execution_package"]
        self.context = request["payload"]["context"]
        self.transaction_intent = request["payload"]["transaction_intent"]
        self.rollback_result = request["payload"].get("rollback_result")
        self._raw: dict[str, bytes] = {}
        self._json: dict[str, dict[str, Any]] = {}

    def raw(self, role: str, maximum: int = MAX_JSON_BYTES) -> bytes:
        if role not in self._raw:
            self._raw[role] = read_source_bytes(self.manifest, role, maximum)
        return self._raw[role]

    def fd(self, role: str, *, maximum_bytes: int = 64 * 1024 * 1024 * 1024) -> int:
        """Return an inherited trusted descriptor without materializing a large artifact."""
        sources = self.manifest.get("sources")
        item = sources.get(role) if isinstance(sources, dict) else None
        package_item = self.package.get("sources", {}).get(role)
        if not isinstance(item, dict) or not isinstance(package_item, dict) \
                or not isinstance(item.get("fd"), int) or item["fd"] < 3 \
                or item.get("sha256") != package_item.get("sha256") \
                or item.get("logical_path") != package_item.get("path") \
                or isinstance(package_item.get("bytes"), bool) \
                or not isinstance(package_item.get("bytes"), int) \
                or not 1 <= package_item["bytes"] <= maximum_bytes:
            reject("ROLLBACK_FIXED_EXECUTOR_SOURCE_FD_INVALID")
        try:
            metadata = os.fstat(item["fd"])
        except OSError:
            reject("ROLLBACK_FIXED_EXECUTOR_SOURCE_FD_INVALID")
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size != package_item["bytes"] \
                or metadata.st_uid != item.get("uid") or metadata.st_gid != item.get("gid") \
                or metadata.st_nlink != 1 or mode_text(metadata) != item.get("mode"):
            reject("ROLLBACK_FIXED_EXECUTOR_SOURCE_FD_INVALID")
        return item["fd"]

    def json(self, role: str) -> dict[str, Any]:
        if role not in self.JSON_ROLES:
            reject("ROLLBACK_FIXED_EXECUTOR_SOURCE_JSON_ROLE_INVALID")
        if role not in self._json:
            self._json[role] = strict_json(
                self.raw(role), "ROLLBACK_FIXED_EXECUTOR_SOURCE_JSON_INVALID",
            )
        return self._json[role]

    @property
    def plan(self) -> dict[str, Any]:
        activation = self.json("runtime_adapter_activation")
        plan = activation.get("plan")
        if not isinstance(plan, dict) \
                or plan.get("runtime_plan_sha256") != self.request["runtime_plan_sha256"] \
                or digest_value(without(plan, "runtime_plan_sha256")) \
                != plan.get("runtime_plan_sha256"):
            reject("ROLLBACK_FIXED_EXECUTOR_RUNTIME_PLAN_INVALID")
        validate_reconciliation_authority(
            plan.get("reconciliation_authority"), plan, self.request,
        )
        validate_volume_helper_plan(
            plan.get("helpers", {}).get("volume_restore"),
            expected_supervisor_bundle_sha256=self.context.get("supervisor_bundle_sha256"),
        )
        return plan


def validate_reconciliation_policy_boundary(inputs: CapabilityInputs) -> dict[str, str]:
    code = "ROLLBACK_FIXED_EXECUTOR_RECONCILIATION_POLICY_INVALID"
    try:
        access = inputs.json("snapshot_runtime_privilege_access")
        catalog = inputs.json("snapshot_runtime_privilege_compiled_catalog")
        policy = inputs.json("snapshot_runtime_privilege_policy")
        operator = inputs.json("snapshot_runtime_privilege_operator_policy")
        plan = inputs.plan
        package_sources = inputs.package["sources"]
        bindings = plan["source_bindings"]
    except (KeyError, TypeError):
        reject(code)
    identities = (
        (access, 2, "chenyida-erp-postgresql-runtime-privilege-access/v2"),
        (catalog, 1, "chenyida-erp-postgresql-runtime-compiled-catalog/v1"),
        (policy, 2, "chenyida-erp-postgresql-runtime-privilege-policy/v2"),
        (operator, 1, "chenyida-erp-postgresql-runtime-privilege-operator-policy/v1"),
    )
    if any(
        not isinstance(document, dict) or document.get("schema_version") != version
        or document.get("contract") != contract
        for document, version, contract in identities
    ) or access.get("authorization_status") != "BLOCKED" \
            or catalog.get("evidence_scope") != "SYNTHETIC_ISOLATED_ONLY" \
            or policy.get("evidence_scope") != "SYNTHETIC_ISOLATED_ONLY" \
            or policy.get("authorization_status") != "ISOLATED_RECONCILIATION_ONLY" \
            or policy.get("deployment_authorized") is not False \
            or operator.get("evidence_scope") != "CONTROLLED_RUNTIME_ONLY" \
            or operator.get("deployment_authorized") is not False:
        reject(code)
    hashes = {
        "access_sha256": access.get("access_sha256"),
        "catalog_sha256": catalog.get("catalog_sha256"),
        "catalog_artifact_sha256": catalog.get("artifact_sha256"),
        "policy_sha256": policy.get("policy_sha256"),
        "operator_policy_sha256": operator.get("policy_sha256"),
    }
    if any(not SHA256.fullmatch(value or "") for value in hashes.values()) \
            or digest_compact_value(without(access, "access_sha256")) \
                != hashes["access_sha256"] \
            or digest_value(catalog.get("catalog")) != hashes["catalog_sha256"] \
            or digest_value(without(catalog, "artifact_sha256")) \
                != hashes["catalog_artifact_sha256"] \
            or digest_value(without(policy, "policy_sha256")) != hashes["policy_sha256"] \
            or digest_value(without(operator, "policy_sha256")) \
                != hashes["operator_policy_sha256"]:
        reject(code)
    try:
        policy_access = policy["source_binding"]["access_intent"]
        policy_catalog = policy["source_binding"]["compiled_catalog"]
        catalog_access = catalog["source_binding"]["access_intent"]
        role_sources = {
            "snapshot_runtime_privilege_access":
                "runtime_privilege_access_sha256",
            "snapshot_runtime_privilege_compiled_catalog":
                "runtime_privilege_compiled_catalog_sha256",
            "snapshot_runtime_privilege_policy":
                "runtime_privilege_policy_sha256",
            "snapshot_runtime_privilege_operator_policy":
                "runtime_privilege_operator_policy_sha256",
        }
        source_hashes = {
            role: package_sources[role]["sha256"] for role in role_sources
        }
    except (KeyError, TypeError):
        reject(code)
    if policy_access.get("access_sha256") != hashes["access_sha256"] \
            or policy_access.get("file_sha256") \
                != source_hashes["snapshot_runtime_privilege_access"] \
            or catalog_access.get("access_sha256") != hashes["access_sha256"] \
            or catalog_access.get("file_sha256") \
                != source_hashes["snapshot_runtime_privilege_access"] \
            or policy_catalog.get("catalog_sha256") != hashes["catalog_sha256"] \
            or policy_catalog.get("artifact_sha256") \
                != hashes["catalog_artifact_sha256"] \
            or policy_catalog.get("file_sha256") \
                != source_hashes["snapshot_runtime_privilege_compiled_catalog"] \
            or operator.get("runtime_privilege_policy_sha256") != hashes["policy_sha256"] \
            or any(
                bindings.get(binding) != source_hashes[role]
                for role, binding in role_sources.items()
            ):
        reject(code)
    return hashes


def _writer_candidate_documents(
        inputs: CapabilityInputs,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Revalidate the signed candidate projection needed before stopping writers."""
    code = "ROLLBACK_FIXED_EXECUTOR_WRITER_SPEC_INVALID"
    try:
        plan = inputs.plan
        package = inputs.package
        deployment = inputs.json("candidate_deployment_result")
        identity = inputs.json("candidate_postdeploy_identity")
        source_hashes = package["sources"]
    except (KeyError, TypeError):
        reject(code)
    deployment = exact(deployment, {
        "schema_version", "contract", "status", "promotion_id",
        "deployment_operation_id", "execution_authorization_sha256",
        "supervisor_bundle_sha256", "release_manifest_sha256",
        "migration_operation_id", "migration_execution_authorization_sha256",
        "migration_grant_sha256", "migration_result_sha256", "active_fence_sha256",
        "migration_fence_binding_sha256", "migration_result_binding_sha256",
        "deployment_plan_sha256", "compose_project", "compose_project_root",
        "old_runtime_sha256", "created_runtime_sha256", "committed_runtime_sha256",
        "protected_resources_before_sha256", "protected_resources_after_sha256",
        "runtime_configuration_sha256", "readiness_sha256", "database_handoff",
        "services", "unchanged_services", "started_at", "completed_at", "result_sha256",
    }, code)
    if deployment.get("schema_version") != 1 \
            or deployment.get("contract") \
                != "chenyida-erp-uat-promotion-compose-deployment-result/v1" \
            or deployment.get("status") != "COMPOSE_DEPLOYMENT_COMMITTED" \
            or deployment.get("promotion_id") != package.get("promotion_id") \
            or deployment.get("compose_project") != "chenyida-erp" \
            or deployment.get("compose_project") \
                != plan.get("deployment", {}).get("compose_project") \
            or deployment.get("compose_project_root") \
                != plan.get("deployment", {}).get("compose_project_root") \
            or deployment.get("protected_resources_before_sha256") \
                != deployment.get("protected_resources_after_sha256") \
            or deployment.get("protected_resources_after_sha256") \
                != package.get("protected_resources_sha256") \
            or digest_value(without(deployment, "result_sha256")) \
                != deployment.get("result_sha256") \
            or any(not SHA256.fullmatch(deployment.get(field) or "") for field in (
                "execution_authorization_sha256", "supervisor_bundle_sha256",
                "release_manifest_sha256", "migration_execution_authorization_sha256",
                "migration_grant_sha256", "migration_result_sha256", "active_fence_sha256",
                "migration_fence_binding_sha256", "migration_result_binding_sha256",
                "deployment_plan_sha256", "old_runtime_sha256", "created_runtime_sha256",
                "committed_runtime_sha256", "protected_resources_before_sha256",
                "protected_resources_after_sha256", "runtime_configuration_sha256",
                "readiness_sha256", "result_sha256",
            )):
        reject(code)
    if not isinstance(deployment.get("services"), list) \
            or not isinstance(deployment.get("unchanged_services"), list) \
            or len(deployment["services"]) != 2 \
            or len(deployment["unchanged_services"]) != 2:
        reject(code)

    def service(value: Any, expected: str, *, unchanged: bool) -> dict[str, Any]:
        common = {
            "service", "container_id", "container_name", "image_id", "image_reference",
            "compose_config_sha256", "running", "health", "restart_count", "oom_killed",
        }
        fields = common | ({"pre_identity_sha256", "post_identity_sha256"}
                           if unchanged else set())
        item = exact(value, fields, code)
        expected_health = "healthy" if expected != "caddy" else "none"
        if item.get("service") != expected \
                or item.get("container_name") != f"chenyida-erp-{expected}-1" \
                or not CONTAINER_ID.fullmatch(item.get("container_id") or "") \
                or not IMAGE_DIGEST.fullmatch(item.get("image_id") or "") \
                or not IMAGE_REFERENCE.fullmatch(item.get("image_reference") or "") \
                or not SHA256.fullmatch(item.get("compose_config_sha256") or "") \
                or item.get("running") is not True or item.get("health") != expected_health \
                or item.get("restart_count") != 0 or item.get("oom_killed") is not False:
            reject(code)
        if unchanged and (
                not SHA256.fullmatch(item.get("pre_identity_sha256") or "")
                or item.get("pre_identity_sha256") != item.get("post_identity_sha256")):
            reject(code)
        return item

    observed = {
        "web": service(deployment["services"][0], "web", unchanged=False),
        "worker": service(deployment["services"][1], "worker", unchanged=False),
        "caddy": service(deployment["unchanged_services"][0], "caddy", unchanged=True),
        "postgres": service(
            deployment["unchanged_services"][1], "postgres", unchanged=True,
        ),
    }
    if len({item["container_id"] for item in observed.values()}) != 4:
        reject(code)
    planned_services = plan.get("candidate", {}).get("services")
    if not isinstance(planned_services, dict) or set(planned_services) != set(observed):
        reject(code)
    for name, item in observed.items():
        planned = planned_services.get(name)
        if not isinstance(planned, dict) \
                or planned.get("container_id") != item["container_id"] \
                or planned.get("image_reference") != item["image_reference"] \
                or planned.get("image_digest") != item["image_id"]:
            reject(code)

    handoff = exact(deployment.get("database_handoff"), {
        "schema_version", "contract", "status", "promotion_id",
        "deployment_operation_id", "database_name", "database_system_identifier",
        "database_oid", "database_marker", "active_fence_sha256",
        "released_baseline_sha256", "sealed_probe_sha256", "runtime_probe_sha256",
        "database_allow_connections", "database_connection_limit",
        "default_transaction_read_only", "connect_roles", "unknown_connect_login_count",
        "prepared_transaction_count", "handed_off_at", "handoff_sha256",
    }, code)
    database = package.get("database")
    if handoff.get("schema_version") != 1 \
            or handoff.get("contract") \
                != "chenyida-erp-uat-promotion-database-runtime-handoff/v1" \
            or handoff.get("status") \
                != "RUNTIME_BASELINE_RESTORED_UNDER_DEPLOYMENT_CONTROL" \
            or not isinstance(database, dict) \
            or handoff.get("database_name") != database.get("name") \
            or handoff.get("database_system_identifier") != database.get("system_identifier") \
            or handoff.get("database_oid") != database.get("oid") \
            or handoff.get("database_marker") != database.get("marker") \
            or not SYSTEM_IDENTIFIER.fullmatch(handoff.get("database_system_identifier") or "") \
            or not OID.fullmatch(handoff.get("database_oid") or "") \
            or handoff.get("database_allow_connections") is not True \
            or handoff.get("database_connection_limit") != 64 \
            or handoff.get("default_transaction_read_only") != "RESET" \
            or handoff.get("unknown_connect_login_count") != 0 \
            or handoff.get("prepared_transaction_count") != 0 \
            or digest_value(without(handoff, "handoff_sha256")) \
                != handoff.get("handoff_sha256"):
        reject(code)

    identity = exact(identity, {
        "schema_version", "contract", "deployment_class", "deployment_id", "release_id",
        "release_manifest_sha256", "postdeploy_receipt_sha256",
        "supervisor_bundle_sha256", "authorization_sha256", "runtime_guard",
        "runtime_policy_sha256", "application_version", "git_commit", "git_tree",
        "migration_head", "migration_manifest_sha256", "caddy_container_id",
        "caddy_image_digest", "postgres_container_id", "postgres_image_digest",
        "web_container_id", "web_image_digest", "worker_container_id",
        "worker_image_digest", "generated_at",
    }, code)
    if identity.get("schema_version") != 3 \
            or identity.get("contract") != "chenyida-erp-runtime-release-identity/v3" \
            or identity.get("deployment_class") != "UAT" \
            or identity.get("deployment_id") != "chenyida-erp" \
            or identity.get("release_manifest_sha256") \
                != deployment["release_manifest_sha256"] \
            or any(identity.get(f"{name}_container_id") != item["container_id"]
                   or identity.get(f"{name}_image_digest") != item["image_id"]
                   for name, item in observed.items()) \
            or not ISO_UTC.fullmatch(identity.get("generated_at") or ""):
        reject(code)
    for role in ("candidate_deployment_result", "candidate_postdeploy_identity"):
        source = source_hashes.get(role)
        if not isinstance(source, dict) or not SHA256.fullmatch(source.get("sha256") or ""):
            reject(code)
    return deployment, identity, observed


def derive_writer_containment_spec(inputs: CapabilityInputs) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_WRITER_SPEC_INVALID"
    deployment, _identity, observed = _writer_candidate_documents(inputs)
    plan = inputs.plan
    package = inputs.package
    handoff = deployment["database_handoff"]
    services = {
        name: {
            "container_id": observed[name]["container_id"],
            "image_reference": observed[name]["image_reference"],
            "image_digest": observed[name]["image_id"],
        }
        for name in ("web", "worker")
    }
    postgres = observed["postgres"]
    body = {
        "schema_version": 1, "contract": WRITER_SPEC_CONTRACT,
        "rollback_operation_id": plan["rollback_operation_id"],
        "runtime_plan_sha256": plan["runtime_plan_sha256"],
        "source_set_sha256": package["source_set_sha256"],
        "deployment_result_sha256": deployment["result_sha256"],
        "postdeploy_identity_source_sha256":
            package["sources"]["candidate_postdeploy_identity"]["sha256"],
        "protected_resources_sha256": deployment["protected_resources_after_sha256"],
        "active_fence_sha256": handoff["active_fence_sha256"],
        "services": services,
        "candidate_service_set_sha256": digest_value(services),
        "postgres": {
            "container_id": postgres["container_id"],
            "image_reference": postgres["image_reference"],
            "image_digest": postgres["image_id"],
            "management_database": "postgres", "control_os_user": "999:999",
        },
        "database": {
            "name": handoff["database_name"],
            "system_identifier": handoff["database_system_identifier"],
            "oid": handoff["database_oid"], "marker": handoff["database_marker"],
        },
        "excluded_databases": sorted((
            plan["targets"]["database"]["staging"],
            plan["targets"]["database"]["candidate_quarantine"],
        )),
    }
    return validate_writer_containment_spec({**body, "spec_sha256": digest_value(body)})


def validate_writer_containment_spec(value: Any) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_WRITER_SPEC_INVALID"
    spec = exact(value, {
        "schema_version", "contract", "rollback_operation_id", "runtime_plan_sha256",
        "source_set_sha256", "deployment_result_sha256",
        "postdeploy_identity_source_sha256", "protected_resources_sha256",
        "active_fence_sha256", "services", "candidate_service_set_sha256", "postgres",
        "database", "excluded_databases", "spec_sha256",
    }, code)
    if spec.get("schema_version") != 1 or spec.get("contract") != WRITER_SPEC_CONTRACT \
            or not IDENTIFIER.fullmatch(spec.get("rollback_operation_id") or "") \
            or any(not SHA256.fullmatch(spec.get(field) or "") for field in (
                "runtime_plan_sha256", "source_set_sha256", "deployment_result_sha256",
                "postdeploy_identity_source_sha256", "protected_resources_sha256",
                "active_fence_sha256", "candidate_service_set_sha256", "spec_sha256",
            )) or digest_value(without(spec, "spec_sha256")) != spec.get("spec_sha256"):
        reject(code)
    services = exact(spec.get("services"), {"web", "worker"}, code)
    for item in services.values():
        item = exact(item, {"container_id", "image_reference", "image_digest"}, code)
        if not CONTAINER_ID.fullmatch(item.get("container_id") or "") \
                or not IMAGE_REFERENCE.fullmatch(item.get("image_reference") or "") \
                or not IMAGE_DIGEST.fullmatch(item.get("image_digest") or ""):
            reject(code)
    if len({item["container_id"] for item in services.values()}) != 2 \
            or digest_value(services) != spec["candidate_service_set_sha256"]:
        reject(code)
    postgres = exact(spec.get("postgres"), {
        "container_id", "image_reference", "image_digest", "management_database",
        "control_os_user",
    }, code)
    if not CONTAINER_ID.fullmatch(postgres.get("container_id") or "") \
            or not IMAGE_REFERENCE.fullmatch(postgres.get("image_reference") or "") \
            or not IMAGE_DIGEST.fullmatch(postgres.get("image_digest") or "") \
            or postgres.get("management_database") != "postgres" \
            or postgres.get("control_os_user") != "999:999" \
            or postgres["container_id"] in {item["container_id"] for item in services.values()}:
        reject(code)
    database = exact(spec.get("database"), {
        "name", "system_identifier", "oid", "marker",
    }, code)
    excluded = spec.get("excluded_databases")
    if not DATABASE_IDENTIFIER.fullmatch(database.get("name") or "") \
            or not SYSTEM_IDENTIFIER.fullmatch(database.get("system_identifier") or "") \
            or not OID.fullmatch(database.get("oid") or "") \
            or database.get("marker") != "chenyida-erp-deployment/v2:UAT:chenyida-erp" \
            or not isinstance(excluded, list) or len(excluded) != 2 \
            or excluded != sorted(excluded) or len(set(excluded)) != 2 \
            or database["name"] in excluded \
            or any(DATABASE_IDENTIFIER.fullmatch(item or "") is None for item in excluded):
        reject(code)
    return spec


def _postgres_snapshot_manifest(inputs: CapabilityInputs) -> tuple[dict[str, Any], dict[str, Any]]:
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_BASE_SPEC_INVALID"
    manifest = exact(inputs.json("snapshot_manifest"), {
        "schema_version", "contract", "status", "backup_id", "created_at", "deployment",
        "application", "migration", "policy", "consistency", "reconciliation", "artifacts",
    }, code)
    if manifest.get("schema_version") != 2 \
            or manifest.get("contract") != "chenyida-erp-backup/v2" \
            or manifest.get("status") != "COMPLETE":
        reject(code)
    deployment = exact(manifest.get("deployment"), {
        "class", "id", "database", "database_system_identifier", "database_oid",
        "database_marker", "database_bytes", "database_server_major", "database_encoding",
        "database_collate", "database_ctype", "database_locale_provider",
        "database_collation_version",
    }, code)
    application = exact(manifest.get("application"), {
        "version", "git_commit", "web_image_digest", "worker_image_digest",
    }, code)
    migration = exact(manifest.get("migration"), {
        "head", "manifest_file", "manifest_sha256",
    }, code)
    reconciliation = exact(manifest.get("reconciliation"), {
        "contract", "file", "sha256",
    }, code)
    artifacts = exact(manifest.get("artifacts"), {
        "postgresql_dump", "uploads", "attachments", "backup_status",
    }, code)
    dump = exact(artifacts.get("postgresql_dump"), {"file", "sha256", "bytes"}, code)
    package = inputs.package
    try:
        package_database = package["database"]
        package_dump = package["snapshot_objects"]["postgresql"]
        package_predecessor = package["predecessor"]
        package_sources = package["sources"]
        package_reconciliation = package["content_reconciliation"]
    except (KeyError, TypeError):
        reject(code)
    if deployment.get("class") != "UAT" or deployment.get("id") != "chenyida-erp" \
            or deployment.get("database") != package_database.get("name") \
            or deployment.get("database_system_identifier") \
                != package_database.get("system_identifier") \
            or deployment.get("database_oid") != package_database.get("oid") \
            or deployment.get("database_marker") != package_database.get("marker") \
            or isinstance(deployment.get("database_bytes"), bool) \
            or not isinstance(deployment.get("database_bytes"), int) \
            or not 1 <= deployment["database_bytes"] <= 64 * 1024 * 1024 * 1024 \
            or deployment.get("database_server_major") != "17" \
            or deployment.get("database_locale_provider") != "libc" \
            or dump.get("file") != "postgresql.dump" \
            or dump.get("sha256") != package_dump.get("sha256") \
            or dump.get("bytes") != package_dump.get("bytes") \
            or dump.get("sha256") != package_sources["snapshot_postgresql"].get("sha256") \
            or dump.get("bytes") != package_sources["snapshot_postgresql"].get("bytes") \
            or migration.get("head") != package_predecessor.get("migration_head") \
            or migration.get("manifest_file") != "migrations.txt" \
            or migration.get("manifest_sha256") \
                != (package_sources.get("snapshot_migrations") or {}).get("sha256") \
            or reconciliation.get("contract") \
                != "chenyida-erp-backup-reconciliation/v1" \
            or reconciliation.get("file") != "reconciliation.json" \
            or reconciliation.get("sha256") \
                != package_reconciliation.get("source_reconciliation_sha256") \
            or application.get("version") != package_predecessor.get("application_version") \
            or application.get("git_commit") != package_predecessor.get("git_commit"):
        reject(code)
    for value, pattern in (
        (deployment.get("database_system_identifier"), SYSTEM_IDENTIFIER),
        (deployment.get("database_oid"), OID),
        (dump.get("sha256"), SHA256),
        (migration.get("head"), MIGRATION),
        (migration.get("manifest_sha256"), SHA256),
        (reconciliation.get("sha256"), SHA256),
    ):
        if not isinstance(value, str) or pattern.fullmatch(value) is None:
            reject(code)
    return manifest, deployment


def derive_pg_rollback_base_spec(inputs: CapabilityInputs) -> dict[str, Any]:
    """Derive the PostgreSQL mutation boundary only from already validated FD inputs."""
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_BASE_SPEC_INVALID"
    plan = inputs.plan
    package = inputs.package
    manifest, deployment = _postgres_snapshot_manifest(inputs)
    hashes = validate_reconciliation_policy_boundary(inputs)
    access = inputs.json("snapshot_runtime_privilege_access")
    catalog_document = inputs.json("snapshot_runtime_privilege_compiled_catalog")
    policy = inputs.json("snapshot_runtime_privilege_policy")
    operator = inputs.json("snapshot_runtime_privilege_operator_policy")
    try:
        sources = package["sources"]
        postgres = plan["candidate"]["services"]["postgres"]
        databases = plan["targets"]["database"]
        engine = catalog_document["engine_binding"]
        database_policy = policy["database"]
        schema_policy = policy["schema"]
        operator_target = operator["target"]
        authority_source = plan["reconciliation_authority"]
        snapshot_dump = package["snapshot_objects"]["postgresql"]
        reconciliation = package["content_reconciliation"]
        predecessor = package["predecessor"]
    except (KeyError, TypeError):
        reject(code)
    if plan.get("promotion_id") != package.get("promotion_id") \
            or plan.get("promotion_generation") != package.get("promotion_generation") \
            or plan.get("rollback_operation_id") != package.get("rollback_operation_id") \
            or plan.get("runtime_plan_sha256") != package.get("runtime_plan_sha256") \
            or plan.get("deployment", {}).get("class") != "UAT" \
            or plan.get("deployment", {}).get("id") != "chenyida-erp" \
            or plan.get("deployment", {}).get("database") != package.get("database") \
            or plan.get("source_bindings", {}).get("snapshot_manifest_sha256") \
                != sources.get("snapshot_manifest", {}).get("sha256") \
            or plan.get("source_bindings", {}).get("snapshot_reconciliation_sha256") \
                != reconciliation.get("source_reconciliation_sha256"):
        reject(code)
    expected_profile = {
        "encoding": deployment.get("database_encoding"),
        "locale_provider": deployment.get("database_locale_provider"),
        "collate": deployment.get("database_collate"),
        "ctype": deployment.get("database_ctype"),
        "collation_version": None if deployment.get("database_collation_version") == "NONE"
            else deployment.get("database_collation_version"),
        "default_tablespace": "pg_default",
    }
    if any(engine.get(field) != expected_profile[field] for field in (
        "encoding", "locale_provider", "collate", "ctype", "collation_version",
    )) or any(database_policy.get(field) != expected_profile[field] for field in (
        "encoding", "locale_provider", "collate", "ctype", "collation_version",
    )) or database_policy.get("default_tablespace") != "pg_default" \
            or database_policy.get("name") != databases.get("active") \
            or database_policy.get("connection_limit") != 64 \
            or database_policy.get("allow_connect") is not True \
            or database_policy.get("public_privileges") != [] \
            or schema_policy.get("name") != "public" \
            or schema_policy.get("public_privileges") != [] \
            or operator_target.get("database") != databases.get("active") \
            or operator_target.get("migration_owner") != database_policy.get("owner") \
            or operator_target.get("server_version_num") != engine.get("server_version_num") \
            or operator_target.get("listen_addresses") != "*" \
            or engine.get("server_major") != "17" \
            or not isinstance(engine.get("server_version_num"), str) \
            or re.fullmatch(r"17[0-9]{4}", engine["server_version_num"]) is None \
            or not isinstance(engine.get("image_reference"), str) \
            or postgres.get("image_reference", "").rsplit("@", 1)[-1] \
                != engine["image_reference"].rsplit("@", 1)[-1]:
        reject(code)
    active_database = package.get("database", {})
    operation_id = plan.get("rollback_operation_id")
    if not isinstance(operation_id, str) or IDENTIFIER.fullmatch(operation_id) is None \
            or databases.get("active") != active_database.get("name") \
            or active_database.get("marker") \
                != "chenyida-erp-deployment/v2:UAT:chenyida-erp" \
            or len({databases.get("active"), databases.get("staging"),
                    databases.get("candidate_quarantine")}) != 3:
        reject(code)
    profile = {**expected_profile, "profile_sha256": digest_value(expected_profile)}
    security = {
        "access_file_sha256": sources["snapshot_runtime_privilege_access"]["sha256"],
        "access_sha256": hashes["access_sha256"],
        "catalog_file_sha256":
            sources["snapshot_runtime_privilege_compiled_catalog"]["sha256"],
        "catalog_sha256": hashes["catalog_sha256"],
        "catalog_artifact_sha256": hashes["catalog_artifact_sha256"],
        "policy_file_sha256": sources["snapshot_runtime_privilege_policy"]["sha256"],
        "policy_sha256": hashes["policy_sha256"],
        "operator_file_sha256":
            sources["snapshot_runtime_privilege_operator_policy"]["sha256"],
        "operator_policy_sha256": hashes["operator_policy_sha256"],
        "runtime_privilege_policy_sha256": operator["runtime_privilege_policy_sha256"],
        "database_owner": database_policy["owner"],
        "schema_name": schema_policy["name"],
        "schema_owner": schema_policy["owner"],
        "roles_projection_sha256": digest_value(policy["roles"]),
        "memberships_projection_sha256": digest_value(policy["memberships"]),
        "ownership_projection_sha256": digest_value({
            key: catalog_document["catalog"][key]
            for key in ("schema", "schema_owner", "tables", "sequences", "routines",
                        "standalone_types")
        }),
        "acl_projection_sha256": digest_value({
            "access_catalog": access["catalog"], "services": access["services"],
            "service_bindings": policy["service_bindings"],
            "acl_summary": policy["acl_summary"],
        }),
        "default_acl_projection_sha256": digest_value(policy["default_privileges"]),
        "unsupported_projection_sha256": digest_value({
            "catalog": catalog_document["catalog"]["unsupported"],
            "constraints": policy["object_constraints"],
            "tablespaces": policy["tablespaces"],
        }),
    }
    authority = {
        "authority_id": authority_source["authority_id"],
        "authority_sha256": authority_source["authority_sha256"],
        "approved_at": authority_source["approved_at"],
        "expires_at": authority_source["expires_at"],
        "one_time": authority_source["one_time"],
        "mutation_scope_sha256": digest_value(authority_source["mutation_scope"]),
    }
    migration_ledger = validate_migration_ledger(
        inputs.raw("snapshot_migrations"),
        expected_ledger_file_sha256=sources["snapshot_migrations"]["sha256"],
        expected_allowlist_sha256=predecessor["migration_manifest_sha256"],
        expected_head=predecessor["migration_head"],
    )
    body = {
        "schema_version": 1,
        "contract": POSTGRES_BASE_SPEC_CONTRACT,
        "environment": "UAT",
        "deployment_id": "chenyida-erp",
        "promotion_id": package["promotion_id"],
        "promotion_generation": package["promotion_generation"],
        "rollback_operation_id": operation_id,
        "runtime_plan_sha256": plan["runtime_plan_sha256"],
        "source_set_sha256": package["source_set_sha256"],
        "package_sha256": package["package_sha256"],
        "postgres": {
            "container_id": postgres["container_id"],
            "image_reference": postgres["image_reference"],
            "image_digest": postgres["image_digest"],
            "control_os_user": "999:999",
            "control_database_role": "postgres",
            "management_database": "postgres",
            "system_identifier": active_database["system_identifier"],
            "server_version_num": engine["server_version_num"],
            "server_major": engine["server_major"],
            "listen_addresses": operator_target["listen_addresses"],
        },
        "databases": {
            "active_name": databases["active"],
            "candidate_oid": active_database["oid"],
            "candidate_marker": active_database["marker"],
            "staging_name": databases["staging"],
            "staging_marker": f"chenyida-erp-uat-rollback/v1:{operation_id}:RESTORED_STAGING",
            "quarantine_name": databases["candidate_quarantine"],
            "quarantine_marker":
                f"chenyida-erp-uat-rollback/v1:{operation_id}:CANDIDATE_QUARANTINE",
        },
        "snapshot": {
            "dump_sha256": snapshot_dump["sha256"],
            "dump_bytes": snapshot_dump["bytes"],
            "database_bytes": deployment["database_bytes"],
            "snapshot_manifest_sha256": sources["snapshot_manifest"]["sha256"],
            "source_reconciliation_sha256":
                reconciliation["source_reconciliation_sha256"],
            "target_database_report_sha256": reconciliation["database"]["report_sha256"],
            "migration_head": predecessor["migration_head"],
            "migration_ledger_file_sha256": migration_ledger["ledger_file_sha256"],
            "migration_allowlist_sha256": migration_ledger["allowlist_sha256"],
        },
        "profile": profile,
        "security": security,
        "authority": authority,
        "runtime_limits": {
            "preflight_seconds": TIMEOUTS["PREFLIGHT"],
            "recheck_seconds": TIMEOUTS["RECHECK"],
            "prepare_seconds": TIMEOUTS["PREPARE"],
            "execute_seconds": TIMEOUTS["EXECUTE"],
            "probe_seconds": TIMEOUTS["PROBE"],
            "contain_seconds": TIMEOUTS["CONTAIN"],
            "sql_max_bytes": 1024 * 1024,
            "output_max_bytes": MAX_JSON_BYTES,
        },
    }
    return validate_pg_rollback_base_spec({**body, "base_spec_sha256": digest_value(body)})


def validate_pg_rollback_base_spec(value: Any) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_BASE_SPEC_INVALID"
    spec = exact(value, {
        "schema_version", "contract", "environment", "deployment_id", "promotion_id",
        "promotion_generation", "rollback_operation_id", "runtime_plan_sha256",
        "source_set_sha256", "package_sha256", "postgres", "databases", "snapshot",
        "profile", "security", "authority", "runtime_limits", "base_spec_sha256",
    }, code)
    if spec.get("schema_version") != 1 or spec.get("contract") != POSTGRES_BASE_SPEC_CONTRACT \
            or spec.get("environment") != "UAT" or spec.get("deployment_id") != "chenyida-erp" \
            or not isinstance(spec.get("promotion_generation"), int) \
            or not 1 <= spec["promotion_generation"] <= 1_000_000 \
            or digest_value(without(spec, "base_spec_sha256")) \
                != spec.get("base_spec_sha256"):
        reject(code)
    for field in ("promotion_id", "rollback_operation_id"):
        if not IDENTIFIER.fullmatch(spec.get(field) or ""):
            reject(code)
    for field in ("runtime_plan_sha256", "source_set_sha256", "package_sha256",
                  "base_spec_sha256"):
        if not SHA256.fullmatch(spec.get(field) or "") or spec[field] == ZERO_SHA256:
            reject(code)
    postgres = exact(spec.get("postgres"), {
        "container_id", "image_reference", "image_digest", "control_os_user",
        "control_database_role", "management_database", "system_identifier",
        "server_version_num", "server_major", "listen_addresses",
    }, code)
    if not CONTAINER_ID.fullmatch(postgres.get("container_id") or "") \
            or not IMAGE_REFERENCE.fullmatch(postgres.get("image_reference") or "") \
            or not IMAGE_DIGEST.fullmatch(postgres.get("image_digest") or "") \
            or postgres.get("control_os_user") != "999:999" \
            or postgres.get("control_database_role") != "postgres" \
            or postgres.get("management_database") != "postgres" \
            or not SYSTEM_IDENTIFIER.fullmatch(postgres.get("system_identifier") or "") \
            or not re.fullmatch(r"17[0-9]{4}", postgres.get("server_version_num") or "") \
            or postgres.get("server_major") != "17" or postgres.get("listen_addresses") != "*":
        reject(code)
    databases = exact(spec.get("databases"), {
        "active_name", "candidate_oid", "candidate_marker", "staging_name",
        "staging_marker", "quarantine_name", "quarantine_marker",
    }, code)
    if any(DATABASE_IDENTIFIER.fullmatch(databases.get(field) or "") is None for field in (
        "active_name", "staging_name", "quarantine_name",
    )) or len({databases["active_name"], databases["staging_name"],
               databases["quarantine_name"]}) != 3 \
            or not OID.fullmatch(databases.get("candidate_oid") or "") \
            or databases.get("candidate_marker") \
                != "chenyida-erp-deployment/v2:UAT:chenyida-erp" \
            or not RESTORED_STAGING_MARKER.fullmatch(databases.get("staging_marker") or "") \
            or not CANDIDATE_QUARANTINE_MARKER.fullmatch(
                databases.get("quarantine_marker") or ""):
        reject(code)
    snapshot = exact(spec.get("snapshot"), {
        "dump_sha256", "dump_bytes", "database_bytes", "snapshot_manifest_sha256",
        "source_reconciliation_sha256", "target_database_report_sha256",
        "migration_head", "migration_ledger_file_sha256", "migration_allowlist_sha256",
    }, code)
    if any(not SHA256.fullmatch(snapshot.get(field) or "") for field in (
        "dump_sha256", "snapshot_manifest_sha256", "source_reconciliation_sha256",
        "target_database_report_sha256", "migration_ledger_file_sha256",
        "migration_allowlist_sha256",
    )) or any(isinstance(snapshot.get(field), bool) or not isinstance(snapshot.get(field), int)
              or not 1 <= snapshot[field] <= 64 * 1024 * 1024 * 1024
              for field in ("dump_bytes", "database_bytes")) \
            or not MIGRATION.fullmatch(snapshot.get("migration_head") or ""):
        reject(code)
    profile = exact(spec.get("profile"), {
        "encoding", "locale_provider", "collate", "ctype", "collation_version",
        "default_tablespace", "profile_sha256",
    }, code)
    profile_body = without(profile, "profile_sha256")
    if any(not isinstance(profile.get(field), str) or not 1 <= len(profile[field]) <= 120
           for field in ("encoding", "locale_provider", "collate", "ctype")) \
            or profile.get("collation_version") is not None \
                and (not isinstance(profile["collation_version"], str)
                     or not 1 <= len(profile["collation_version"]) <= 120) \
            or profile.get("locale_provider") != "libc" \
            or profile.get("default_tablespace") != "pg_default" \
            or digest_value(profile_body) != profile.get("profile_sha256"):
        reject(code)
    security = exact(spec.get("security"), {
        "access_file_sha256", "access_sha256", "catalog_file_sha256", "catalog_sha256",
        "catalog_artifact_sha256", "policy_file_sha256", "policy_sha256",
        "operator_file_sha256", "operator_policy_sha256",
        "runtime_privilege_policy_sha256", "database_owner", "schema_name", "schema_owner",
        "roles_projection_sha256", "memberships_projection_sha256",
        "ownership_projection_sha256", "acl_projection_sha256",
        "default_acl_projection_sha256", "unsupported_projection_sha256",
    }, code)
    if any(not SHA256.fullmatch(security.get(field) or "") for field in security
           if field.endswith("_sha256")) \
            or any(not isinstance(security.get(field), str)
                   or DATABASE_IDENTIFIER.fullmatch(security[field]) is None
                   for field in ("database_owner", "schema_name", "schema_owner")):
        reject(code)
    authority = exact(spec.get("authority"), {
        "authority_id", "authority_sha256", "approved_at", "expires_at", "one_time",
        "mutation_scope_sha256",
    }, code)
    if not IDENTIFIER.fullmatch(authority.get("authority_id") or "") \
            or any(not SHA256.fullmatch(authority.get(field) or "") for field in (
                "authority_sha256", "mutation_scope_sha256",
            )) or authority.get("one_time") is not True \
            or any(not isinstance(authority.get(field), str)
                   or ISO_UTC.fullmatch(authority[field]) is None
                   for field in ("approved_at", "expires_at")):
        reject(code)
    limits = exact(spec.get("runtime_limits"), {
        "preflight_seconds", "recheck_seconds", "prepare_seconds", "execute_seconds",
        "probe_seconds", "contain_seconds", "sql_max_bytes", "output_max_bytes",
    }, code)
    expected_limits = {
        "preflight_seconds": 120, "recheck_seconds": 120, "prepare_seconds": 120,
        "execute_seconds": 1800, "probe_seconds": 300, "contain_seconds": 300,
        "sql_max_bytes": 1024 * 1024, "output_max_bytes": MAX_JSON_BYTES,
    }
    if limits != expected_limits:
        reject(code)
    return spec


def _pg_identifier(value: str) -> str:
    if not isinstance(value, str) or DATABASE_IDENTIFIER.fullmatch(value) is None:
        reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_OPCODE_SPEC_INVALID")
    return f'"{value}"'


def _pg_literal(value: str) -> str:
    if not isinstance(value, str) or not 1 <= len(value.encode("utf-8")) <= 512 \
            or "\x00" in value or "\n" in value or "\r" in value:
        reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_OPCODE_SPEC_INVALID")
    return "'" + value.replace("'", "''") + "'"


def _pg_guarded_literal(value: str) -> str:
    """Quote only trusted generated JSON used by the fixed guarded-switch SQL."""
    if not isinstance(value, str) \
            or not 1 <= len(value.encode("utf-8")) <= 768 * 1024 \
            or "\x00" in value or "\n" in value or "\r" in value:
        reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_GUARDED_SWITCH_INVALID")
    return "'" + value.replace("'", "''") + "'"


def render_writer_sql(
        spec: dict[str, Any], opcode: str, bindings: dict[str, Any],
) -> bytes:
    spec = validate_writer_containment_spec(spec)
    code = "ROLLBACK_FIXED_EXECUTOR_WRITER_OPCODE_INVALID"
    if opcode not in WRITER_SQL_OPCODES:
        reject(code)
    fields = {
        "PG_RB_OBSERVE_WRITER_FENCE_V1": {
            "journal_state_sha256", "observation_scope_sha256",
        },
        "PG_RB_SEAL_ACTIVE_V1": {
            "before_observation_sha256", "expected_fence_sha256",
        },
    }[opcode]
    bindings = exact(bindings, fields, code)
    if any(not SHA256.fullmatch(value or "") or value == ZERO_SHA256
           for value in bindings.values()):
        reject(code)
    database = spec["database"]
    active = _pg_identifier(database["name"])
    active_name = _pg_literal(database["name"])
    active_oid = _pg_literal(database["oid"])
    active_marker = _pg_literal(database["marker"])
    system_identifier = _pg_literal(database["system_identifier"])
    excluded = ",".join(_pg_literal(item) for item in spec["excluded_databases"])
    lock_name = _pg_literal(f"chenyida-erp-uat-rollback:{spec['runtime_plan_sha256']}")
    if opcode == "PG_RB_OBSERVE_WRITER_FENCE_V1":
        sql = f"""SELECT pg_catalog.json_build_object(
  'system_identifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
  'database',(
    SELECT pg_catalog.json_build_object(
      'name',d.datname,'oid',d.oid::text,
      'marker',pg_catalog.shobj_description(d.oid,'pg_database'),
      'allow_connections',d.datallowconn,'connection_limit',d.datconnlimit,
      'default_transaction_read_only',EXISTS(
        SELECT 1 FROM pg_catalog.pg_db_role_setting s
        WHERE s.setdatabase=d.oid AND s.setrole=0
          AND 'default_transaction_read_only=on'=ANY(s.setconfig)),
      'sessions',(SELECT count(*) FROM pg_catalog.pg_stat_activity a WHERE a.datid=d.oid),
      'prepared_xacts',(SELECT count(*) FROM pg_catalog.pg_prepared_xacts x WHERE x.database=d.datname)
    ) FROM pg_catalog.pg_database d WHERE d.datname={active_name}),
  'excluded_database_count',(
    SELECT count(*) FROM pg_catalog.pg_database WHERE datname IN ({excluded}))
)::text;
"""
    else:
        sql = f"""BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended({lock_name},0));
DO $cyd$
BEGIN
  IF (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> {system_identifier}
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_database d
       WHERE d.datname={active_name} AND d.oid::text={active_oid}
         AND pg_catalog.shobj_description(d.oid,'pg_database')={active_marker}
         AND d.datallowconn=true AND d.datconnlimit=64
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s
           WHERE s.setdatabase=d.oid AND s.setrole=0
             AND 'default_transaction_read_only=on'=ANY(s.setconfig)))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname IN ({excluded}))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_prepared_xacts WHERE database={active_name})
  THEN RAISE EXCEPTION 'rollback writer fence precondition mismatch'; END IF;
END
$cyd$;
ALTER DATABASE {active} SET default_transaction_read_only TO on;
ALTER DATABASE {active} ALLOW_CONNECTIONS false;
ALTER DATABASE {active} CONNECTION LIMIT 0;
SELECT pg_catalog.pg_terminate_backend(pid)
FROM pg_catalog.pg_stat_activity
WHERE datname={active_name} AND pid<>pg_catalog.pg_backend_pid();
COMMIT;
"""
    raw = sql.encode("utf-8")
    if not raw.endswith(b"\n") or len(raw) > 1024 * 1024:
        reject(code)
    return raw


def derive_writer_opcode_spec(
        spec: dict[str, Any], opcode: str, bindings: dict[str, Any],
) -> dict[str, Any]:
    spec = validate_writer_containment_spec(spec)
    if opcode not in WRITER_SQL_OPCODES:
        reject("ROLLBACK_FIXED_EXECUTOR_WRITER_OPCODE_INVALID")
    raw = render_writer_sql(spec, opcode, bindings)
    phase = "writer-observe" if opcode == "PG_RB_OBSERVE_WRITER_FENCE_V1" \
        else "writer-seal"
    body = {
        "schema_version": 1, "contract": WRITER_OPCODE_SPEC_CONTRACT,
        "opcode": opcode, "writer_spec_sha256": spec["spec_sha256"],
        "database": "postgres", "phase": phase, "timeout_seconds": 300,
        "effectful": opcode == "PG_RB_SEAL_ACTIVE_V1", "bindings": bindings,
        "sql_sha256": hashlib.sha256(raw).hexdigest(),
        "argv_template_sha256": digest_value([
            "DOCKER_EXEC_POSTGRES_PSQL_V1", spec["postgres"]["container_id"],
            "postgres", phase,
        ]),
    }
    return validate_writer_opcode_spec(
        {**body, "opcode_spec_sha256": digest_value(body)}, spec=spec,
    )


def validate_writer_opcode_spec(
        value: Any, *, spec: dict[str, Any],
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_WRITER_OPCODE_INVALID"
    spec = validate_writer_containment_spec(spec)
    item = exact(value, {
        "schema_version", "contract", "opcode", "writer_spec_sha256", "database",
        "phase", "timeout_seconds", "effectful", "bindings", "sql_sha256",
        "argv_template_sha256", "opcode_spec_sha256",
    }, code)
    if item.get("schema_version") != 1 \
            or item.get("contract") != WRITER_OPCODE_SPEC_CONTRACT \
            or item.get("opcode") not in WRITER_SQL_OPCODES \
            or item.get("writer_spec_sha256") != spec["spec_sha256"] \
            or item.get("database") != "postgres" or item.get("timeout_seconds") != 300 \
            or item.get("effectful") != (item["opcode"] == "PG_RB_SEAL_ACTIVE_V1") \
            or any(not SHA256.fullmatch(item.get(field) or "") for field in (
                "sql_sha256", "argv_template_sha256", "opcode_spec_sha256",
            )) or digest_value(without(item, "opcode_spec_sha256")) \
                != item["opcode_spec_sha256"]:
        reject(code)
    phase = "writer-observe" if item["opcode"] == "PG_RB_OBSERVE_WRITER_FENCE_V1" \
        else "writer-seal"
    raw = render_writer_sql(spec, item["opcode"], item.get("bindings"))
    if item.get("phase") != phase \
            or hashlib.sha256(raw).hexdigest() != item["sql_sha256"] \
            or digest_value([
                "DOCKER_EXEC_POSTGRES_PSQL_V1", spec["postgres"]["container_id"],
                "postgres", phase,
            ]) != item["argv_template_sha256"]:
        reject(code)
    return item


def parse_writer_database_observation(
        raw: bytes, *, spec: dict[str, Any], observed_at: str,
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_WRITER_OBSERVATION_INVALID"
    spec = validate_writer_containment_spec(spec)
    value = exact(parse_tool_json(raw, code), {
        "system_identifier", "database", "excluded_database_count",
    }, code)
    row = exact(value.get("database"), {
        "name", "oid", "marker", "allow_connections", "connection_limit",
        "default_transaction_read_only", "sessions", "prepared_xacts",
    }, code)
    expected = spec["database"]
    if value.get("system_identifier") != expected["system_identifier"] \
            or value.get("excluded_database_count") != 0 \
            or row.get("name") != expected["name"] or row.get("oid") != expected["oid"] \
            or row.get("marker") != expected["marker"] \
            or not isinstance(row.get("allow_connections"), bool) \
            or isinstance(row.get("connection_limit"), bool) \
            or not isinstance(row.get("connection_limit"), int) \
            or not isinstance(row.get("default_transaction_read_only"), bool) \
            or any(isinstance(row.get(field), bool) or not isinstance(row.get(field), int)
                   or not 0 <= row[field] <= 1_000_000
                   for field in ("sessions", "prepared_xacts")) \
            or not ISO_UTC.fullmatch(observed_at or ""):
        reject(code)
    initial = row["allow_connections"] is True and row["connection_limit"] == 64 \
        and row["default_transaction_read_only"] is False \
        and row["prepared_xacts"] == 0
    sealed = row["allow_connections"] is False and row["connection_limit"] == 0 \
        and row["default_transaction_read_only"] is True \
        and row["sessions"] == 0 and row["prepared_xacts"] == 0
    state = "INITIAL" if initial else "SEALED" if sealed else "INVALID"
    body = {
        "schema_version": 1,
        "contract": "chenyida-erp-uat-rollback-writer-database-observation/v1",
        "runtime_plan_sha256": spec["runtime_plan_sha256"],
        "writer_spec_sha256": spec["spec_sha256"], "state": state,
        "database": row, "observed_at": observed_at,
    }
    return {**body, "observation_sha256": digest_value(body)}


def parse_writer_container_observation(
        raw: bytes, *, spec: dict[str, Any], expected_status: str,
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_WRITER_CONTAINER_OBSERVATION_INVALID"
    spec = validate_writer_containment_spec(spec)
    if expected_status not in {"running", "exited"} \
            or not isinstance(raw, bytes) or not 2 <= len(raw) <= 1024 * 1024 \
            or not raw.endswith(b"\n"):
        reject(code)
    lines = raw.splitlines()
    if len(lines) != 2 or any(not line for line in lines):
        reject(code)
    expected_by_id = {
        item["container_id"]: (name, item) for name, item in spec["services"].items()
    }
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for line in lines:
        value = parse_tool_json(line, code, maximum=1024 * 1024)
        if not isinstance(value, list) or len(value) != 17:
            reject(code)
        (
            container_id, container_name, image_id, image_reference, labels, status,
            health, restart_count, oom_killed, mounts, networks, user, readonly_rootfs,
            cap_drop, cap_add, security_opt, network_mode,
        ) = value
        expected_pair = expected_by_id.get(container_id)
        if expected_pair is None or container_id in seen:
            reject(code)
        service_name, expected = expected_pair
        health_status = None if health is None else health.get("Status") \
            if isinstance(health, dict) else None
        if container_name != f"/chenyida-erp-{service_name}-1" \
                or image_id != expected["image_digest"] \
                or image_reference != expected["image_reference"] \
                or status != expected_status \
                or not isinstance(labels, dict) \
                or labels.get("com.docker.compose.project") != "chenyida-erp" \
                or labels.get("com.docker.compose.service") != service_name \
                or any(not isinstance(key, str) or not isinstance(item, str)
                       or any(ord(character) < 32 for character in key + item)
                       for key, item in labels.items()) \
                or expected_status == "running" and health_status != "healthy" \
                or health is not None and not isinstance(health, dict) \
                or restart_count != 0 or oom_killed is not False \
                or not isinstance(mounts, list) or not isinstance(networks, dict) \
                or not isinstance(user, str) or not isinstance(readonly_rootfs, bool) \
                or cap_drop is not None and not isinstance(cap_drop, list) \
                or cap_add is not None and not isinstance(cap_add, list) \
                or security_opt is not None and not isinstance(security_opt, list) \
                or not isinstance(network_mode, str):
            reject(code)
        seen.add(container_id)
        normalized.append({
            "service": service_name, "container_id": container_id,
            "image_digest": image_id, "image_reference": image_reference,
            "status": status, "health_status": health_status,
            "restart_count": restart_count, "oom_killed": oom_killed,
            "configuration_sha256": digest_value({
                "labels": labels, "mounts": mounts, "networks": networks, "user": user,
                "readonly_rootfs": readonly_rootfs, "cap_drop": cap_drop,
                "cap_add": cap_add, "security_opt": security_opt,
                "network_mode": network_mode,
            }),
        })
    if seen != set(expected_by_id):
        reject(code)
    normalized.sort(key=lambda item: item["service"])
    body = {
        "schema_version": 1,
        "contract": "chenyida-erp-uat-rollback-writer-container-observation/v1",
        "runtime_plan_sha256": spec["runtime_plan_sha256"], "status": expected_status,
        "services": normalized,
    }
    return {**body, "service_set_sha256": digest_value(body)}


def parse_writer_stop_ack(raw: bytes, expected_ids: list[str]) -> str:
    code = "ROLLBACK_FIXED_EXECUTOR_WRITER_STOP_ACK_INVALID"
    if not isinstance(raw, bytes) or not raw or len(raw) > 256 * 1024 \
            or not isinstance(expected_ids, list) or len(expected_ids) != 2 \
            or expected_ids != sorted(expected_ids) \
            or any(CONTAINER_ID.fullmatch(item or "") is None for item in expected_ids):
        reject(code)
    try:
        lines = raw.decode("ascii").splitlines()
    except UnicodeDecodeError:
        reject(code)
    if lines != expected_ids:
        reject(code)
    return digest_value({"stopped_container_ids": lines})


def parse_runtime_writer_stop_ack(raw: bytes, expected_ids: list[str]) -> str:
    code = "ROLLBACK_FIXED_EXECUTOR_RUNTIME_CONTAINMENT_INVALID"
    if not isinstance(expected_ids, list) or not 1 <= len(expected_ids) <= 64 \
            or expected_ids != sorted(set(expected_ids)) \
            or any(CONTAINER_ID.fullmatch(item or "") is None for item in expected_ids) \
            or not isinstance(raw, bytes) or not raw or len(raw) > 256 * 1024:
        reject(code)
    try:
        lines = raw.decode("ascii").splitlines()
    except UnicodeDecodeError:
        reject(code)
    if lines != expected_ids:
        reject(code)
    return digest_value({"stopped_container_ids": lines})


def parse_predecessor_image_observation(
        raw: bytes, *, image_reference: str, image_config_digest: str,
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_PREDECESSOR_IMAGE_INVALID"
    if not IMAGE_REFERENCE.fullmatch(image_reference or "") \
            or not IMAGE_DIGEST.fullmatch(image_config_digest or ""):
        reject(code)
    value = parse_tool_json(raw, code, maximum=512 * 1024)
    if not isinstance(value, list) or len(value) != 9:
        reject(code)
    (
        image_id, operating_system, architecture, repo_digests, descriptor,
        command, entrypoint, working_directory, stop_signal,
    ) = value
    registry_digest = "sha256:" + image_reference.rsplit("@sha256:", 1)[-1]
    descriptor_digest = descriptor.get("digest") if isinstance(descriptor, dict) else None
    if image_id != image_config_digest or operating_system != "linux" \
            or architecture != "amd64" or not isinstance(repo_digests, list) \
            or repo_digests.count(image_reference) != 1 \
            or any(not IMAGE_REFERENCE.fullmatch(item or "") for item in repo_digests) \
            or descriptor_digest not in {None, registry_digest} \
            or command is not None and not isinstance(command, list) \
            or entrypoint is not None and not isinstance(entrypoint, list) \
            or not isinstance(working_directory, str) or not isinstance(stop_signal, str):
        reject(code)
    body = {
        "image_reference": image_reference, "image_config_digest": image_id,
        "registry_digest": registry_digest, "platform": "linux/amd64",
        "repo_digest_set_sha256": digest_value(sorted(repo_digests)),
        "runtime_config_sha256": digest_value({
            "command": command, "entrypoint": entrypoint,
            "working_directory": working_directory, "stop_signal": stop_signal,
        }),
    }
    return {**body, "image_observation_sha256": digest_value(body)}


def parse_project_container_discovery(raw: bytes) -> list[str]:
    code = "ROLLBACK_FIXED_EXECUTOR_PROJECT_CONTAINER_DISCOVERY_INVALID"
    if not isinstance(raw, bytes) or not raw or len(raw) > 256 * 1024 \
            or not raw.endswith(b"\n"):
        reject(code)
    try:
        identifiers = raw.decode("ascii").splitlines()
    except UnicodeDecodeError:
        reject(code)
    if len(identifiers) != 4 or len(set(identifiers)) != 4 \
            or any(CONTAINER_ID.fullmatch(item or "") is None for item in identifiers):
        reject(code)
    return sorted(identifiers)


def parse_runtime_project_container_discovery(raw: bytes) -> list[str]:
    code = "ROLLBACK_FIXED_EXECUTOR_RUNTIME_OBSERVATION_INVALID"
    if not isinstance(raw, bytes) or not raw or len(raw) > 256 * 1024 \
            or not raw.endswith(b"\n"):
        reject(code)
    try:
        identifiers = raw.decode("ascii").splitlines()
    except UnicodeDecodeError:
        reject(code)
    if not 4 <= len(identifiers) <= 64 \
            or len(set(identifiers)) != len(identifiers) \
            or any(CONTAINER_ID.fullmatch(item or "") is None for item in identifiers):
        reject(code)
    return sorted(identifiers)


def parse_activation_service_observation(
        raw: bytes, *, plan: dict[str, Any], discovered_ids: list[str],
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_ACTIVATION_SERVICE_INVALID"
    if not isinstance(plan, dict) or not isinstance(discovered_ids, list) \
            or len(discovered_ids) != 4 or discovered_ids != sorted(discovered_ids) \
            or not isinstance(raw, bytes) or not raw.endswith(b"\n") \
            or not 2 <= len(raw) <= 2 * 1024 * 1024:
        reject(code)
    lines = raw.splitlines()
    if len(lines) != 4:
        reject(code)
    try:
        candidate = plan["candidate"]["services"]
        predecessor = plan["predecessor"]
        volumes = plan["targets"]["volumes"]
        project = plan["deployment"]["compose_project"]
    except (KeyError, TypeError):
        reject(code)
    expected_networks = {
        "caddy": {f"{project}_edge"},
        "postgres": {f"{project}_backend"},
        "web": {f"{project}_backend", f"{project}_edge"},
        "worker": {f"{project}_backend"},
    }
    required_volumes = {
        "web": {
            "/data/chenyida-erp/uploads": (volumes["uploads"]["target"], True),
            "/data/chenyida-erp/attachments": (volumes["attachments"]["target"], True),
            "/data/chenyida-erp/backup-status":
                (volumes["backup_status"]["target"], False),
        },
        "worker": {
            "/data/chenyida-erp/uploads": (volumes["uploads"]["target"], True),
            "/data/chenyida-erp/attachments": (volumes["attachments"]["target"], True),
        },
    }
    forbidden_candidate_volumes = {
        item["name"] for item in plan["candidate"]["volumes"].values()
    }
    services: dict[str, dict[str, Any]] = {}
    for line in lines:
        value = parse_tool_json(line, code, maximum=2 * 1024 * 1024)
        if not isinstance(value, list) or len(value) != 17:
            reject(code)
        (
            container_id, container_name, image_id, image_reference, labels, status,
            health, restart_count, oom_killed, mounts, networks, user, readonly_rootfs,
            cap_drop, cap_add, security_opt, network_mode,
        ) = value
        service = labels.get("com.docker.compose.service") \
            if isinstance(labels, dict) else None
        if service not in {"caddy", "postgres", "web", "worker"} \
                or service in services or container_id not in discovered_ids \
                or container_name != f"/{project}-{service}-1" \
                or labels.get("com.docker.compose.project") != project:
            reject(code)
        planned = candidate[service]
        if service in {"web", "worker"}:
            expected_reference = predecessor[f"{service}_image"]
            expected_image_id = predecessor[f"{service}_image_config_digest"]
            if container_id == planned["container_id"] \
                    or labels.get("chenyida.erp.uat-rollback-operation") \
                        != plan["rollback_operation_id"] \
                    or labels.get("chenyida.erp.uat-rollback-runtime-plan") \
                        != plan["runtime_plan_sha256"]:
                reject(code)
        else:
            expected_reference = planned["image_reference"]
            expected_image_id = planned["image_digest"]
            if container_id != planned["container_id"]:
                reject(code)
        health_status = None if health is None else health.get("Status") \
            if isinstance(health, dict) else None
        expected_health = None if service == "caddy" else "healthy"
        if image_id != expected_image_id or image_reference != expected_reference \
                or status != "running" or health_status != expected_health \
                or restart_count != 0 or oom_killed is not False \
                or not isinstance(mounts, list) or not isinstance(networks, dict) \
                or set(networks) != expected_networks[service] \
                or not isinstance(user, str) or readonly_rootfs is not True \
                or cap_drop != ["ALL"] or cap_add is not None and not isinstance(cap_add, list) \
                or not isinstance(security_opt, list) \
                or not any(item in {"no-new-privileges", "no-new-privileges:true"}
                           for item in security_opt) \
                or not isinstance(network_mode, str):
            reject(code)
        volume_mounts: dict[str, tuple[str, bool]] = {}
        for mount in mounts:
            if not isinstance(mount, dict):
                reject(code)
            if mount.get("Type") == "volume":
                name = mount.get("Name")
                destination = mount.get("Destination")
                writable = mount.get("RW")
                if not isinstance(name, str) or not isinstance(destination, str) \
                        or not isinstance(writable, bool) or name in forbidden_candidate_volumes:
                    reject(code)
                volume_mounts[destination] = (name, writable)
        if service in required_volumes and any(
                volume_mounts.get(destination) != expected
                for destination, expected in required_volumes[service].items()
        ):
            reject(code)
        services[service] = {
            "service": service, "container_id": container_id,
            "image_reference": image_reference, "image_config_digest": image_id,
            "running": True, "healthy": service == "caddy" or health_status == "healthy",
            "health": "none" if service == "caddy" else "healthy",
            "healthcheck_present": service != "caddy", "restart_count": 0,
            "oom_killed": False, "configuration_sha256": digest_value({
                "labels": labels, "mounts": mounts, "networks": networks, "user": user,
                "readonly_rootfs": readonly_rootfs, "cap_drop": cap_drop,
                "cap_add": cap_add, "security_opt": security_opt,
                "network_mode": network_mode,
            }),
        }
    if set(services) != {"caddy", "postgres", "web", "worker"} \
            or len({item["container_id"] for item in services.values()}) != 4:
        reject(code)
    ordered = [services[name] for name in ("caddy", "postgres", "web", "worker")]
    body = {
        "schema_version": 1,
        "contract": "chenyida-erp-uat-rollback-activation-service-observation/v1",
        "runtime_plan_sha256": plan["runtime_plan_sha256"], "services": ordered,
    }
    return {**body, "service_set_sha256": digest_value(body)}


def parse_runtime_container_observation(
        raw: bytes, *, plan: dict[str, Any], discovered_ids: list[str],
) -> dict[str, Any]:
    """Normalize the complete Compose project without trusting container names as selectors."""
    code = "ROLLBACK_FIXED_EXECUTOR_RUNTIME_OBSERVATION_INVALID"
    if not isinstance(plan, dict) or not isinstance(discovered_ids, list) \
            or not 4 <= len(discovered_ids) <= 64 \
            or discovered_ids != sorted(set(discovered_ids)) \
            or not isinstance(raw, bytes) or not raw.endswith(b"\n") \
            or not 2 <= len(raw) <= 4 * 1024 * 1024:
        reject(code)
    lines = raw.splitlines()
    if len(lines) != len(discovered_ids):
        reject(code)
    try:
        candidate = plan["candidate"]["services"]
        predecessor = plan["predecessor"]
        project = plan["deployment"]["compose_project"]
    except (KeyError, TypeError):
        reject(code)
    expected_networks = {
        "caddy": {f"{project}_edge"},
        "postgres": {f"{project}_backend"},
        "web": {f"{project}_backend", f"{project}_edge"},
        "worker": {f"{project}_backend"},
    }
    canonical_services: dict[str, dict[str, Any]] = {}
    canonical_generations: dict[str, str] = {}
    canonical_mounts: dict[str, dict[str, tuple[str, bool]]] = {}
    writer_members: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for line in lines:
        value = parse_tool_json(line, code, maximum=4 * 1024 * 1024)
        if not isinstance(value, list) or len(value) != 17:
            reject(code)
        (
            container_id, container_name, image_id, image_reference, labels, status,
            health, restart_count, oom_killed, mounts, networks, user, readonly_rootfs,
            cap_drop, cap_add, security_opt, network_mode,
        ) = value
        service = labels.get("com.docker.compose.service") \
            if isinstance(labels, dict) else None
        canonical_name = f"/{project}-{service}-1"
        canonical_member = container_name == canonical_name
        if container_id not in discovered_ids or container_id in seen_ids \
                or CONTAINER_ID.fullmatch(container_id or "") is None \
                or service not in {"caddy", "postgres", "web", "worker"} \
                or labels.get("com.docker.compose.project") != project \
                or not isinstance(container_name, str) \
                or status not in {"running", "exited", "created"} \
                or restart_count != 0 or oom_killed is not False \
                or not isinstance(mounts, list) or not isinstance(networks, dict) \
                or set(networks) != expected_networks[service] \
                or not isinstance(user, str) or readonly_rootfs is not True \
                or cap_drop != ["ALL"] \
                or cap_add is not None and not isinstance(cap_add, list) \
                or not isinstance(security_opt, list) \
                or not any(item in {"no-new-privileges", "no-new-privileges:true"}
                           for item in security_opt) \
                or not isinstance(network_mode, str):
            reject(code)
        seen_ids.add(container_id)
        if not canonical_member and service in {"caddy", "postgres"}:
            reject(code)
        running = status == "running"
        health_status = None if health is None else health.get("Status") \
            if isinstance(health, dict) else None
        if running and health_status != (None if service == "caddy" else "healthy"):
            reject(code)
        if canonical_member:
            if service in canonical_services:
                reject(code)
            planned = candidate[service]
            generation = "CANDIDATE"
            expected_reference = planned["image_reference"]
            expected_image_id = planned["image_digest"]
            observation_digest = expected_image_id
            if service in {"web", "worker"} and (
                    image_reference == predecessor[f"{service}_image"]
                    and image_id == predecessor[f"{service}_image_config_digest"]
            ):
                generation = "PREDECESSOR"
                expected_reference = predecessor[f"{service}_image"]
                expected_image_id = predecessor[f"{service}_image_config_digest"]
                observation_digest = "sha256:" + expected_reference.rsplit(
                    "@sha256:", 1,
                )[-1]
            if image_reference != expected_reference or image_id != expected_image_id \
                    or service in {"caddy", "postgres"} \
                    and container_id != planned["container_id"] \
                    or service in {"web", "worker"} and generation == "CANDIDATE" \
                    and container_id != planned["container_id"]:
                reject(code)
            volume_mounts: dict[str, tuple[str, bool]] = {}
            for mount in mounts:
                if not isinstance(mount, dict):
                    reject(code)
                if mount.get("Type") == "volume":
                    name = mount.get("Name")
                    destination = mount.get("Destination")
                    writable = mount.get("RW")
                    if not isinstance(name, str) or not isinstance(destination, str) \
                            or not isinstance(writable, bool):
                        reject(code)
                    volume_mounts[destination] = (name, writable)
            canonical_mounts[service] = volume_mounts
            canonical_generations[service] = generation
            canonical_services[service] = {
                "service": service, "container_id": container_id,
                "image_reference": image_reference, "image_digest": observation_digest,
                "running": running,
                "health": "none" if running and service == "caddy"
                else "healthy" if running else "stopped",
                "restart_count": restart_count, "oom_killed": False,
            }
        if service in {"web", "worker"}:
            writer_members.append({
                "writer_key": service if canonical_member
                else f"unexpected_{service}_{container_id[:16]}",
                "service": service, "container_id": container_id,
                "running": running, "unexpected": not canonical_member,
            })
    if seen_ids != set(discovered_ids) \
            or set(canonical_services) != {"caddy", "postgres", "web", "worker"} \
            or len(writer_members) < 2:
        reject(code)
    writer_members.sort(key=lambda item: item["writer_key"])
    if len({item["writer_key"] for item in writer_members}) != len(writer_members):
        reject(code)
    writer_identities = [{
        key: item[key] for key in (
            "writer_key", "service", "container_id", "unexpected",
        )
    } for item in writer_members]
    writer_inventory = {
        "discovery_scope": "COMPOSE_PROJECT_COMPLETE_WRITER_SET",
        "discovery_complete": True, "members": writer_members,
        "writer_set_sha256": digest_value(writer_identities),
        "active_writer_count": sum(item["running"] for item in writer_members),
        "unexpected_writer_count": sum(item["unexpected"] for item in writer_members),
    }
    required_mounts = {
        "uploads": "/data/chenyida-erp/uploads",
        "attachments": "/data/chenyida-erp/attachments",
        "backup_status": "/data/chenyida-erp/backup-status",
    }
    active_volumes: dict[str, str] = {}
    for domain, destination in required_mounts.items():
        web_mount = canonical_mounts["web"].get(destination)
        if web_mount is None or web_mount[1] != (domain != "backup_status"):
            reject(code)
        if domain != "backup_status" \
                and canonical_mounts["worker"].get(destination) != web_mount:
            reject(code)
        active_volumes[domain] = web_mount[0]
    return {
        "services": canonical_services, "service_generations": canonical_generations,
        "writer_inventory": writer_inventory, "active_volume_names": active_volumes,
    }


def parse_runtime_database_observation(
        raw: bytes, *, plan: dict[str, Any],
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_RUNTIME_OBSERVATION_INVALID"
    value = exact(parse_tool_json(raw, code), {
        "system_identifier", "databases",
    }, code)
    try:
        expected_database = plan["deployment"]["database"]
        targets = plan["targets"]["database"]
    except (KeyError, TypeError):
        reject(code)
    if value.get("system_identifier") != expected_database["system_identifier"] \
            or not isinstance(value.get("databases"), list) \
            or not 1 <= len(value["databases"]) <= 3:
        reject(code)
    allowed = {targets["active"], targets["staging"], targets["candidate_quarantine"]}
    rows: dict[str, dict[str, Any]] = {}
    for item in value["databases"]:
        item = exact(item, {
            "name", "oid", "marker", "allow_connections", "connection_limit",
            "default_transaction_read_only", "writer_sessions", "prepared_xacts",
        }, code)
        if item["name"] not in allowed or item["name"] in rows \
                or OID.fullmatch(item.get("oid") or "") is None \
                or not isinstance(item.get("marker"), str) \
                or not isinstance(item.get("allow_connections"), bool) \
                or isinstance(item.get("connection_limit"), bool) \
                or not isinstance(item.get("connection_limit"), int) \
                or not isinstance(item.get("default_transaction_read_only"), bool) \
                or any(isinstance(item.get(field), bool)
                       or not isinstance(item.get(field), int) or item[field] < 0
                       for field in ("writer_sessions", "prepared_xacts")):
            reject(code)
        rows[item["name"]] = item
    active = rows.get(targets["active"])
    if not isinstance(active, dict) \
            or active["marker"] != expected_database["marker"] \
            or active["prepared_xacts"] != 0:
        reject(code)
    released = active["allow_connections"] is True \
        and active["connection_limit"] == 64 \
        and active["default_transaction_read_only"] is False
    sealed = active["allow_connections"] is False \
        and active["connection_limit"] == 0 \
        and active["default_transaction_read_only"] is True \
        and active["writer_sessions"] == 0
    if released == sealed:
        reject(code)
    database = {
        "name": active["name"], "system_identifier": value["system_identifier"],
        "oid": active["oid"], "marker": active["marker"],
        "allow_connections": active["allow_connections"],
        "writer_sessions": active["writer_sessions"], "sealed": sealed,
    }
    derived = {
        "staging": {
            "name": targets["staging"], "present": targets["staging"] in rows,
            "oid": rows.get(targets["staging"], {}).get("oid"),
        },
        "candidate_quarantine": {
            "name": targets["candidate_quarantine"],
            "present": targets["candidate_quarantine"] in rows,
            "oid": rows.get(targets["candidate_quarantine"], {}).get("oid"),
        },
    }
    return {"database": database, "derived_database": derived, "rows": rows}


def create_runtime_original_observation(plan: dict[str, Any]) -> dict[str, Any]:
    writer_members = [{
        "writer_key": service, "service": service,
        "container_id": plan["candidate"]["services"][service]["container_id"],
        "running": True, "unexpected": False,
    } for service in ("web", "worker")]
    body = {
        "schema_version": 1, "contract": RUNTIME_OBSERVATION_CONTRACT,
        "active_generation": "CANDIDATE",
        "database": {
            **plan["deployment"]["database"], "allow_connections": True,
            "writer_sessions": 0, "sealed": False,
        },
        "services": {
            service: {
                **identity, "running": True,
                "health": "none" if service == "caddy" else "healthy",
                "restart_count": 0, "oom_killed": False,
            }
            for service, identity in plan["candidate"]["services"].items()
        },
        "writer_inventory": {
            "discovery_scope": "COMPOSE_PROJECT_COMPLETE_WRITER_SET",
            "discovery_complete": True, "members": writer_members,
            "writer_set_sha256": digest_value([{
                key: item[key] for key in (
                    "writer_key", "service", "container_id", "unexpected",
                )
            } for item in writer_members]),
            "active_writer_count": 2, "unexpected_writer_count": 0,
        },
        "volumes": plan["candidate"]["volumes"],
        "retained_candidate_volumes": {
            domain: {**volume, "present": True}
            for domain, volume in plan["candidate"]["volumes"].items()
        },
        "derived_targets": {
            "database": {
                "staging": {"name": plan["targets"]["database"]["staging"],
                            "present": False, "oid": None},
                "candidate_quarantine": {
                    "name": plan["targets"]["database"]["candidate_quarantine"],
                    "present": False, "oid": None,
                },
            },
            "volumes": {
                domain: {
                    "target": {"name": target["target"], "present": False,
                               "identity_sha256": None},
                    "utility_container": {
                        "name": target["utility_container"], "present": False,
                        "container_id": None,
                    },
                }
                for domain, target in plan["targets"]["volumes"].items()
            },
        },
        "protected_resources_sha256": plan["candidate"]["protected_resources_sha256"],
    }
    return {**body, "observation_sha256": digest_value(body)}


def validate_runtime_containment_intent(
        value: Any, request: dict[str, Any], observation: dict[str, Any],
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_RUNTIME_CONTAINMENT_INVALID"
    item = exact(value, {
        "schema_version", "contract", "status", "operation", "operation_id",
        "promotion_id", "intent_sha256", "execution_package_sha256", "failure_code",
        "ledger_state", "last_committed_ordinal", "last_committed_label",
        "last_committed_record_sha256", "containment_attempt",
        "previous_containment_intent_sha256",
        "previous_containment_attempt_receipt_sha256", "runtime_target_state",
        "runtime_observation_sha256", "expected_writer_inventory_sha256",
        "expected_writer_set_sha256", "expected_active_generation",
        "expected_database_oid", "expected_web_container_id",
        "expected_worker_container_id", "prepared_at", "containment_intent_sha256",
    }, code)
    if item.get("schema_version") != 1 \
            or item.get("contract") \
                != "chenyida-erp-uat-promotion-rollback-containment-intent/v1" \
            or item.get("status") != "PREPARED" \
            or item.get("operation") != request.get("operation") \
            or item.get("operation_id") != request.get("operation_id") \
            or item.get("execution_package_sha256") \
                != request.get("execution_package_sha256") \
            or item.get("containment_intent_sha256") \
                != request.get("record_intent_sha256") \
            or item.get("last_committed_record_sha256") \
                != request.get("previous_result_sha256") \
            or not IDENTIFIER.fullmatch(item.get("promotion_id") or "") \
            or not isinstance(item.get("failure_code"), str) \
            or re.fullmatch(r"[A-Z][A-Z0-9_]{2,159}", item["failure_code"]) is None \
            or item.get("ledger_state") not in {"EMPTY", "EXACT_PREFIX", "UNKNOWN"} \
            or isinstance(item.get("last_committed_ordinal"), bool) \
            or not isinstance(item.get("last_committed_ordinal"), int) \
            or not 0 <= item["last_committed_ordinal"] <= len((*STAGES, *CHECKS)) \
            or item.get("last_committed_label") is not None \
                and not LABEL.fullmatch(item["last_committed_label"]) \
            or isinstance(item.get("containment_attempt"), bool) \
            or not isinstance(item.get("containment_attempt"), int) \
            or not 1 <= item["containment_attempt"] <= 3 \
            or item.get("runtime_target_state") not in {
                "SAFE_TO_EXECUTE", "EXACT_RESULT_ALREADY_DURABLE",
                "PARTIAL_OR_UNKNOWN_REQUIRES_CONTAINMENT",
                "BLOCKED_TARGET_IDENTITY_MISMATCH",
            } \
            or item.get("expected_active_generation") not in {
                "CANDIDATE", "PREDECESSOR", "PARTIAL_OR_UNKNOWN",
            } \
            or OID.fullmatch(item.get("expected_database_oid") or "") is None \
            or any(CONTAINER_ID.fullmatch(item.get(field) or "") is None for field in (
                "expected_web_container_id", "expected_worker_container_id",
            )) \
            or not ISO_UTC.fullmatch(item.get("prepared_at") or ""):
        reject(code)
    for field in (
            "intent_sha256", "last_committed_record_sha256",
            "runtime_observation_sha256", "expected_writer_inventory_sha256",
            "expected_writer_set_sha256", "containment_intent_sha256",
    ):
        if SHA256.fullmatch(item.get(field) or "") is None:
            reject(code)
    for field in (
            "previous_containment_intent_sha256",
            "previous_containment_attempt_receipt_sha256",
    ):
        if item.get(field) is not None and SHA256.fullmatch(item[field]) is None:
            reject(code)
    if digest_value(without(item, "containment_intent_sha256")) \
            != item["containment_intent_sha256"] \
            or observation.get("observation_sha256") \
                != item["runtime_observation_sha256"] \
            or digest_value(observation.get("writer_inventory")) \
                != item["expected_writer_inventory_sha256"] \
            or observation.get("writer_inventory", {}).get("writer_set_sha256") \
                != item["expected_writer_set_sha256"] \
            or observation.get("active_generation") \
                != item["expected_active_generation"] \
            or observation.get("database", {}).get("oid") \
                != item["expected_database_oid"] \
            or observation.get("services", {}).get("web", {}).get("container_id") \
                != item["expected_web_container_id"] \
            or observation.get("services", {}).get("worker", {}).get("container_id") \
                != item["expected_worker_container_id"]:
        reject(code)
    return item


def validate_postdeploy_readiness_document(
        value: Any, code: str = "ROLLBACK_FIXED_EXECUTOR_READINESS_INVALID",
) -> dict[str, Any]:
    readiness = exact(value, {
        "deployment_class", "deployment_id", "version", "revision", "migration_head",
        "migration_manifest_sha256", "database_time", "components",
    }, code)
    expected_components = {
        "postgresql": "READY", "migration": "READY", "worker": "READY",
        "uploads": "READY", "attachments": "READY", "runtime": "READY",
    }
    components = exact(
        readiness.get("components"), set(expected_components), code,
    )
    if readiness.get("deployment_class") != "UAT" \
            or readiness.get("deployment_id") != "chenyida-erp" \
            or not VERSION.fullmatch(readiness.get("version") or "") \
            or re.fullmatch(r"[0-9a-f]{12}", readiness.get("revision") or "") is None \
            or not MIGRATION.fullmatch(readiness.get("migration_head") or "") \
            or not SHA256.fullmatch(readiness.get("migration_manifest_sha256") or "") \
            or not ISO_UTC.fullmatch(readiness.get("database_time") or "") \
            or components != expected_components:
        reject(code)
    try:
        datetime.strptime(readiness["database_time"], "%Y-%m-%dT%H:%M:%S.%fZ")
    except ValueError:
        reject(code)
    return readiness


def parse_health_readiness_response(raw: bytes) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_HEALTH_RESPONSE_INVALID"
    value = exact(parse_tool_json(raw, code), {
        "ok", "status", "database", "storage", "worker", "deployment_class",
        "deployment_id", "version", "revision", "migration_head",
        "migration_manifest_sha256", "components", "time",
    }, code)
    if value.get("ok") is not True or value.get("status") != "READY" \
            or value.get("database") != "postgresql" or value.get("storage") != "local" \
            or value.get("worker") != "postgresql-jobs":
        reject(code)
    return validate_postdeploy_readiness_document({
        "deployment_class": value["deployment_class"],
        "deployment_id": value["deployment_id"],
        "version": value["version"], "revision": value["revision"],
        "migration_head": value["migration_head"],
        "migration_manifest_sha256": value["migration_manifest_sha256"],
        "database_time": value["time"], "components": value["components"],
    }, code)


def validate_postdeploy_receipt_document(value: Any) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_POSTDEPLOY_RECEIPT_INVALID"
    receipt = exact(value, {
        "schema_version", "contract", "run_id", "generated_at", "result",
        "runtime_guard", "control", "deployment", "release", "source", "migrations",
        "runtime_policy_sha256", "runtime_configuration_sha256", "services", "readiness",
    }, code)
    if receipt.get("schema_version") != 1 \
            or receipt.get("contract") != "chenyida-erp-postdeploy-verification/v1" \
            or receipt.get("result") != "PASS" \
            or not IDENTIFIER.fullmatch(receipt.get("run_id") or "") \
            or not ISO_UTC.fullmatch(receipt.get("generated_at") or "") \
            or receipt.get("runtime_guard") != POST_DEPLOY_RUNTIME_GUARD \
            or receipt.get("runtime_policy_sha256") != RELEASE_RUNTIME_POLICY_SHA256 \
            or not SHA256.fullmatch(receipt.get("runtime_configuration_sha256") or ""):
        reject(code)
    control = exact(receipt.get("control"), {
        "supervisor_bundle_sha256", "authorization_sha256",
    }, code)
    if any(not SHA256.fullmatch(item or "") for item in control.values()):
        reject(code)
    deployment = exact(receipt.get("deployment"), {"class", "id", "compose_project"}, code)
    if deployment.get("class") != "UAT" or deployment.get("id") != "chenyida-erp" \
            or deployment.get("compose_project") != deployment["id"]:
        reject(code)
    release = exact(receipt.get("release"), {
        "release_id", "manifest_sha256", "gate_plan_sha256", "gate_report_sha256",
    }, code)
    if not IDENTIFIER.fullmatch(release.get("release_id") or "") \
            or any(not SHA256.fullmatch(release.get(field) or "") for field in (
                "manifest_sha256", "gate_plan_sha256", "gate_report_sha256",
            )):
        reject(code)
    source = exact(receipt.get("source"), {
        "application_version", "git_commit", "git_tree",
    }, code)
    migrations = exact(receipt.get("migrations"), {"head", "manifest_sha256"}, code)
    if not VERSION.fullmatch(source.get("application_version") or "") \
            or not COMMIT.fullmatch(source.get("git_commit") or "") \
            or not COMMIT.fullmatch(source.get("git_tree") or "") \
            or not MIGRATION.fullmatch(migrations.get("head") or "") \
            or not SHA256.fullmatch(migrations.get("manifest_sha256") or ""):
        reject(code)
    services = receipt.get("services")
    if not isinstance(services, list) or len(services) != 4:
        reject(code)
    ids: set[str] = set()
    images: set[str] = set()
    for index, name in enumerate(("caddy", "postgres", "web", "worker")):
        item = exact(services[index], {
            "service", "container_id", "image_id", "image_reference", "restart_count",
            "oom_killed", "running", "restarting", "paused", "dead", "status",
            "health", "healthcheck_present",
        }, code)
        if item.get("service") != name \
                or not CONTAINER_ID.fullmatch(item.get("container_id") or "") \
                or not IMAGE_DIGEST.fullmatch(item.get("image_id") or "") \
                or not IMAGE_REFERENCE.fullmatch(item.get("image_reference") or "") \
                or item.get("restart_count") != 0 or item.get("oom_killed") is not False \
                or item.get("running") is not True or item.get("restarting") is not False \
                or item.get("paused") is not False or item.get("dead") is not False \
                or item.get("status") != "running" \
                or item.get("health") != ("none" if name == "caddy" else "healthy") \
                or item.get("healthcheck_present") is (name == "caddy") \
                or item["container_id"] in ids or item["image_id"] in images:
            reject(code)
        ids.add(item["container_id"])
        images.add(item["image_id"])
    readiness = validate_postdeploy_readiness_document(receipt.get("readiness"), code)
    if readiness.get("deployment_class") != deployment["class"] \
            or readiness.get("deployment_id") != deployment["id"] \
            or readiness.get("version") != source["application_version"] \
            or readiness.get("revision") != source["git_commit"][:12] \
            or readiness.get("migration_head") != migrations["head"] \
            or readiness.get("migration_manifest_sha256") != migrations["manifest_sha256"]:
        reject(code)
    try:
        generated = datetime.strptime(receipt["generated_at"], "%Y-%m-%dT%H:%M:%S.%fZ")
        database_time = datetime.strptime(readiness["database_time"], "%Y-%m-%dT%H:%M:%S.%fZ")
    except ValueError:
        reject(code)
    if abs((generated - database_time).total_seconds()) > 300:
        reject(code)
    return receipt


def validate_release_identity_document(value: Any) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_RELEASE_IDENTITY_INVALID"
    identity = exact(value, {
        "schema_version", "contract", "deployment_class", "deployment_id", "release_id",
        "release_manifest_sha256", "postdeploy_receipt_sha256",
        "supervisor_bundle_sha256", "authorization_sha256", "runtime_guard",
        "runtime_policy_sha256", "application_version", "git_commit", "git_tree",
        "migration_head", "migration_manifest_sha256", "caddy_container_id",
        "caddy_image_digest", "postgres_container_id", "postgres_image_digest",
        "web_container_id", "web_image_digest", "worker_container_id",
        "worker_image_digest", "generated_at",
    }, code)
    if identity.get("schema_version") != 3 \
            or identity.get("contract") != "chenyida-erp-runtime-release-identity/v3" \
            or identity.get("deployment_class") != "UAT" \
            or identity.get("deployment_id") != "chenyida-erp" \
            or not IDENTIFIER.fullmatch(identity.get("release_id") or "") \
            or identity.get("runtime_guard") != POST_DEPLOY_RUNTIME_GUARD \
            or identity.get("runtime_policy_sha256") != RELEASE_RUNTIME_POLICY_SHA256 \
            or not VERSION.fullmatch(identity.get("application_version") or "") \
            or not COMMIT.fullmatch(identity.get("git_commit") or "") \
            or not COMMIT.fullmatch(identity.get("git_tree") or "") \
            or not MIGRATION.fullmatch(identity.get("migration_head") or "") \
            or not ISO_UTC.fullmatch(identity.get("generated_at") or ""):
        reject(code)
    if any(not SHA256.fullmatch(identity.get(field) or "") for field in (
            "release_manifest_sha256", "postdeploy_receipt_sha256",
            "supervisor_bundle_sha256", "authorization_sha256",
            "migration_manifest_sha256",
    )) or any(not CONTAINER_ID.fullmatch(identity.get(f"{name}_container_id") or "")
              or not IMAGE_DIGEST.fullmatch(identity.get(f"{name}_image_digest") or "")
              for name in ("caddy", "postgres", "web", "worker")):
        reject(code)
    if len({identity[f"{name}_container_id"]
            for name in ("caddy", "postgres", "web", "worker")}) != 4 \
            or len({identity[f"{name}_image_digest"]
                    for name in ("caddy", "postgres", "web", "worker")}) != 4:
        reject(code)
    return identity


def parse_release_identity_reader_gid(raw: bytes) -> int:
    """Read one non-secret numeric compose variable without expanding the env file."""
    code = "ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_ENVIRONMENT_INVALID"
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        reject(code)
    if not text or "\x00" in text or "\r" in text:
        reject(code)
    values: dict[str, str] = {}
    for line in text.split("\n"):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        matched = re.fullmatch(
            r"(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)", line,
        )
        if matched is None or matched.group(1) in values:
            reject(code)
        values[matched.group(1)] = matched.group(2)
    value = values.get(RELEASE_IDENTITY_READER_GID_KEY)
    if value is None or re.fullmatch(r"[1-9][0-9]{0,9}", value) is None:
        reject(code)
    reader_gid = int(value)
    if reader_gid > 2**31 - 1:
        reject(code)
    return reader_gid


class ClosedRollbackReleasePublisher:
    """Fixed-root receipt/identity publisher with an observable two-file commit boundary."""

    RECEIPT_MODE = 0o440
    ROOT_MODE = 0o750
    TRANSACTION_MODE = 0o700
    TRANSACTION_FILE_MODE = 0o400
    MAX_IDENTITY_BYTES = 64 * 1024

    def __init__(self, *, filesystem_root: str = "/", fault: Any = None):
        self.filesystem_root = filesystem_root
        self.fault = fault

    def _fault(self, point: str) -> None:
        if self.fault is not None:
            self.fault(point)

    @staticmethod
    def _metadata_identity(item: os.stat_result) -> tuple[Any, ...]:
        return (
            item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns,
            item.st_ctime_ns, item.st_uid, item.st_gid,
            stat.S_IMODE(item.st_mode), item.st_nlink,
        )

    @staticmethod
    def _trusted_owned_directory(
            directory: Path, *, uid: int, gid: int, modes: set[int], code: str,
    ) -> None:
        try:
            metadata = directory.lstat()
        except OSError:
            reject(code)
        if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode) \
                or metadata.st_uid != uid or metadata.st_gid != gid \
                or stat.S_IMODE(metadata.st_mode) not in modes:
            reject(code)

    def _trusted_ancestors(self, logical: str, code: str) -> Path:
        if not logical.startswith("/") or os.path.normpath(logical) != logical:
            reject(code)
        anchor = Path("/") if self.filesystem_root == "/" else Path(self.filesystem_root)
        try:
            anchor_metadata = anchor.lstat()
        except OSError:
            reject(code)
        if not stat.S_ISDIR(anchor_metadata.st_mode) or stat.S_ISLNK(anchor_metadata.st_mode) \
                or anchor_metadata.st_uid != 0 \
                or stat.S_IMODE(anchor_metadata.st_mode) & 0o022:
            reject(code)
        current = anchor
        for component in Path(logical).parts[1:-1]:
            current /= component
            try:
                metadata = current.lstat()
            except OSError:
                reject(code)
            if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode) \
                    or metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) & 0o022:
                reject(code)
        return physical_path(logical, self.filesystem_root)

    @classmethod
    def _trusted_raw(
            cls, file: Path, *, uid: int, gid: int, mode: int,
            maximum: int, code: str,
    ) -> bytes:
        descriptor = -1
        try:
            before = file.lstat()
            descriptor = os.open(
                file, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
                | getattr(os, "O_CLOEXEC", 0),
            )
            opened = os.fstat(descriptor)
            raw = bytearray()
            while len(raw) <= maximum:
                chunk = os.read(descriptor, min(65536, maximum + 1 - len(raw)))
                if not chunk:
                    break
                raw.extend(chunk)
            after = os.fstat(descriptor)
            named = file.lstat()
        except OSError:
            reject(code)
        finally:
            if descriptor >= 0:
                os.close(descriptor)
        if not stat.S_ISREG(before.st_mode) or stat.S_ISLNK(before.st_mode) \
                or before.st_uid != uid or before.st_gid != gid or before.st_nlink != 1 \
                or stat.S_IMODE(before.st_mode) != mode or not 2 <= len(raw) <= maximum \
                or cls._metadata_identity(before) != cls._metadata_identity(opened) \
                or cls._metadata_identity(opened) != cls._metadata_identity(after) \
                or cls._metadata_identity(after) != cls._metadata_identity(named):
            reject(code)
        return bytes(raw)

    @classmethod
    def _trusted_marker(
            cls, root: Path, name: str, expected: bytes, *, gid: int, code: str,
    ) -> None:
        raw = cls._trusted_raw(
            root / name, uid=0, gid=gid, mode=cls.RECEIPT_MODE,
            maximum=max(256, len(expected)), code=code,
        )
        if raw != expected:
            reject(code)

    @staticmethod
    def _sync(directory: Path, code: str) -> None:
        descriptor = -1
        try:
            descriptor = os.open(
                directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
                | getattr(os, "O_NOFOLLOW", 0),
            )
            os.fsync(descriptor)
        except OSError:
            reject(code)
        finally:
            if descriptor >= 0:
                os.close(descriptor)

    @classmethod
    def _write_file(
            cls, target: Path, raw: bytes, *, gid: int, mode: int,
            replace: bool, code: str,
    ) -> None:
        temporary = target.parent / (
            f".{target.name}.{os.getpid()}.{time.monotonic_ns()}.publish.tmp"
        )
        descriptor = -1
        try:
            descriptor = os.open(
                temporary,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL
                | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0),
                0o600,
            )
            written = 0
            while written < len(raw):
                count = os.write(descriptor, raw[written:])
                if count <= 0:
                    raise OSError("short write")
                written += count
            os.fchown(descriptor, 0, gid)
            os.fchmod(descriptor, mode)
            os.fsync(descriptor)
            os.close(descriptor)
            descriptor = -1
            if replace:
                os.replace(temporary, target)
            else:
                if target.exists():
                    raise FileExistsError(str(target))
                os.rename(temporary, target)
            cls._sync(target.parent, code)
        except OSError:
            reject(code)
        finally:
            if descriptor >= 0:
                os.close(descriptor)
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass
            except OSError:
                reject(code)

    @classmethod
    def _read_json(
            cls, file: Path, validator: Any, *, gid: int, maximum: int, code: str,
    ) -> tuple[dict[str, Any], bytes]:
        raw = cls._trusted_raw(
            file, uid=0, gid=gid, mode=cls.RECEIPT_MODE,
            maximum=maximum, code=code,
        )
        value = validator(strict_json(raw, code))
        if raw != canonical(value):
            reject(code)
        return value, raw

    @staticmethod
    def _validated_documents(documents: Any) -> dict[str, Any]:
        code = "ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_DOCUMENT_INVALID"
        value = exact(documents, {
            "receipt", "receipt_sha256", "receipt_json", "identity",
            "identity_sha256", "identity_json",
        }, code)
        receipt = validate_postdeploy_receipt_document(value["receipt"])
        identity = validate_release_identity_document(value["identity"])
        receipt_raw = canonical(receipt)
        identity_raw = canonical(identity)
        if value["receipt_json"] != receipt_raw.decode("utf-8") \
                or value["identity_json"] != identity_raw.decode("utf-8") \
                or value["receipt_sha256"] != hashlib.sha256(receipt_raw).hexdigest() \
                or value["identity_sha256"] != hashlib.sha256(identity_raw).hexdigest() \
                or identity["postdeploy_receipt_sha256"] != value["receipt_sha256"]:
            reject(code)
        return value

    @classmethod
    def _documents_from_receipt(
            cls, receipt: dict[str, Any], receipt_raw: bytes,
    ) -> dict[str, Any]:
        code = "ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_RECEIPT_INVALID"
        receipt = validate_postdeploy_receipt_document(receipt)
        if receipt_raw != canonical(receipt):
            reject(code)
        services = {item["service"]: item for item in receipt["services"]}
        if set(services) != {"caddy", "postgres", "web", "worker"}:
            reject(code)
        receipt_sha256 = hashlib.sha256(receipt_raw).hexdigest()
        identity = validate_release_identity_document({
            "schema_version": 3,
            "contract": "chenyida-erp-runtime-release-identity/v3",
            "deployment_class": receipt["deployment"]["class"],
            "deployment_id": receipt["deployment"]["id"],
            "release_id": receipt["release"]["release_id"],
            "release_manifest_sha256": receipt["release"]["manifest_sha256"],
            "postdeploy_receipt_sha256": receipt_sha256,
            "supervisor_bundle_sha256":
                receipt["control"]["supervisor_bundle_sha256"],
            "authorization_sha256": receipt["control"]["authorization_sha256"],
            "runtime_guard": receipt["runtime_guard"],
            "runtime_policy_sha256": receipt["runtime_policy_sha256"],
            "application_version": receipt["source"]["application_version"],
            "git_commit": receipt["source"]["git_commit"],
            "git_tree": receipt["source"]["git_tree"],
            "migration_head": receipt["migrations"]["head"],
            "migration_manifest_sha256": receipt["migrations"]["manifest_sha256"],
            **{
                f"{name}_container_id": services[name]["container_id"]
                for name in ("caddy", "postgres", "web", "worker")
            },
            **{
                f"{name}_image_digest": services[name]["image_id"]
                for name in ("caddy", "postgres", "web", "worker")
            },
            "generated_at": receipt["generated_at"],
        })
        identity_raw = canonical(identity)
        return cls._validated_documents({
            "receipt": receipt,
            "receipt_sha256": receipt_sha256,
            "receipt_json": receipt_raw.decode("utf-8"),
            "identity": identity,
            "identity_sha256": hashlib.sha256(identity_raw).hexdigest(),
            "identity_json": identity_raw.decode("utf-8"),
        })

    def _reader_gid(self, inputs: CapabilityInputs) -> int:
        return parse_release_identity_reader_gid(
            inputs.raw("deployment_environment", maximum=4 * 1024 * 1024),
        )

    def _roots(self, inputs: CapabilityInputs) -> tuple[int, Path, Path, Path]:
        code = "ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_ROOT_INVALID"
        reader_gid = self._reader_gid(inputs)
        base = self._trusted_ancestors(POSTDEPLOY_ROOT_BASE, code)
        self._trusted_owned_directory(
            base, uid=0, gid=0, modes={0o750, 0o755}, code=code,
        )
        identity_root = self._trusted_ancestors(RELEASE_IDENTITY_ROOT, code)
        self._trusted_owned_directory(
            identity_root, uid=0, gid=reader_gid, modes={self.ROOT_MODE}, code=code,
        )
        self._trusted_marker(
            identity_root, RELEASE_IDENTITY_MARKER, RELEASE_IDENTITY_MARKER_VALUE,
            gid=reader_gid, code=code,
        )
        run_id = inputs.plan["targets"]["rollback_postdeploy_run_id"]
        if not IDENTIFIER.fullmatch(run_id or ""):
            reject(code)
        return reader_gid, base, base / run_id, identity_root

    def _run_root(self, base: Path, run_root: Path, *, create: bool) -> None:
        code = "ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_ROOT_INVALID"
        if not run_root.exists():
            if not create:
                reject(code)
            try:
                os.mkdir(run_root, self.ROOT_MODE)
                os.chown(run_root, 0, 0)
                os.chmod(run_root, self.ROOT_MODE)
                self._sync(base, code)
            except OSError:
                reject(code)
        self._trusted_owned_directory(
            run_root, uid=0, gid=0, modes={self.ROOT_MODE}, code=code,
        )
        marker = run_root / RELEASE_ARTIFACT_MARKER
        if not marker.exists():
            if not create or os.listdir(run_root):
                reject(code)
            self._write_file(
                marker, RELEASE_ARTIFACT_MARKER_VALUE, gid=0,
                mode=self.RECEIPT_MODE, replace=False, code=code,
            )
        self._trusted_marker(
            run_root, RELEASE_ARTIFACT_MARKER, RELEASE_ARTIFACT_MARKER_VALUE,
            gid=0, code=code,
        )

    def _current_identity(
            self, identity_root: Path, reader_gid: int, *, required: bool,
    ) -> tuple[dict[str, Any] | None, bytes | None]:
        target = identity_root / "release-identity.json"
        if not target.exists():
            if required:
                reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_IDENTITY_INVALID")
            return None, None
        return self._read_json(
            target, validate_release_identity_document, gid=reader_gid,
            maximum=self.MAX_IDENTITY_BYTES,
            code="ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_IDENTITY_INVALID",
        )

    def _load_transaction(
            self, identity_root: Path, reader_gid: int,
    ) -> dict[str, Any] | None:
        code = "ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_TRANSACTION_INVALID"
        directory = identity_root / RELEASE_IDENTITY_TRANSACTION_DIRECTORY
        if not directory.exists():
            return None
        self._trusted_owned_directory(
            directory, uid=0, gid=0, modes={self.TRANSACTION_MODE}, code=code,
        )
        if set(os.listdir(directory)) != {"candidate.json", "transaction.json"}:
            reject(code)
        candidate, candidate_raw = self._read_json(
            directory / "candidate.json", validate_release_identity_document,
            gid=reader_gid, maximum=self.MAX_IDENTITY_BYTES, code=code,
        )
        metadata_raw = self._trusted_raw(
            directory / "transaction.json", uid=0, gid=0,
            mode=self.TRANSACTION_FILE_MODE, maximum=4096, code=code,
        )
        metadata = exact(strict_json(metadata_raw, code), {
            "schema_version", "contract", "transaction_id", "authorization_sha256",
            "reader_gid", "candidate_sha256", "previous_sha256", "prepared_at",
        }, code)
        if metadata.get("schema_version") != 1 \
                or metadata.get("contract") != RELEASE_IDENTITY_TRANSACTION_CONTRACT \
                or not IDENTIFIER.fullmatch(metadata.get("transaction_id") or "") \
                or not SHA256.fullmatch(metadata.get("authorization_sha256") or "") \
                or metadata.get("reader_gid") != reader_gid \
                or metadata.get("candidate_sha256") \
                    != hashlib.sha256(candidate_raw).hexdigest() \
                or metadata.get("previous_sha256") is not None \
                    and not SHA256.fullmatch(metadata.get("previous_sha256") or "") \
                or not ISO_UTC.fullmatch(metadata.get("prepared_at") or "") \
                or candidate["authorization_sha256"] \
                    != metadata["authorization_sha256"] \
                or metadata_raw != canonical(metadata):
            reject(code)
        return {"directory": directory, "metadata": metadata, "candidate": candidate}

    def _prepare_transaction(
            self, identity_root: Path, reader_gid: int, documents: dict[str, Any],
            previous_sha256: str,
    ) -> dict[str, Any]:
        code = "ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_TRANSACTION_INVALID"
        existing = self._load_transaction(identity_root, reader_gid)
        if existing is not None:
            if existing["candidate"] != documents["identity"] \
                    or existing["metadata"]["previous_sha256"] != previous_sha256:
                reject(code)
            return existing
        directory = identity_root / RELEASE_IDENTITY_TRANSACTION_DIRECTORY
        try:
            os.mkdir(directory, self.TRANSACTION_MODE)
            os.chown(directory, 0, 0)
            os.chmod(directory, self.TRANSACTION_MODE)
            self._sync(identity_root, code)
        except OSError:
            reject(code)
        self._write_file(
            directory / "candidate.json", canonical(documents["identity"]),
            gid=reader_gid, mode=self.RECEIPT_MODE, replace=False, code=code,
        )
        metadata = {
            "schema_version": 1, "contract": RELEASE_IDENTITY_TRANSACTION_CONTRACT,
            "transaction_id": documents["identity"]["authorization_sha256"],
            "authorization_sha256": documents["identity"]["authorization_sha256"],
            "reader_gid": reader_gid,
            "candidate_sha256": documents["identity_sha256"],
            "previous_sha256": previous_sha256,
            "prepared_at": documents["identity"]["generated_at"],
        }
        self._write_file(
            directory / "transaction.json", canonical(metadata), gid=0,
            mode=self.TRANSACTION_FILE_MODE, replace=False, code=code,
        )
        self._fault("AFTER_RELEASE_IDENTITY_TRANSACTION_PREPARED")
        loaded = self._load_transaction(identity_root, reader_gid)
        if loaded is None:
            reject(code)
        return loaded

    def _remove_transaction(self, identity_root: Path, reader_gid: int) -> None:
        code = "ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_TRANSACTION_INVALID"
        transaction = self._load_transaction(identity_root, reader_gid)
        if transaction is None:
            return
        directory = transaction["directory"]
        try:
            (directory / "transaction.json").unlink()
            self._sync(directory, code)
            (directory / "candidate.json").unlink()
            self._sync(directory, code)
            directory.rmdir()
            self._sync(identity_root, code)
        except OSError:
            reject(code)

    def preflight(self, inputs: CapabilityInputs) -> dict[str, Any]:
        reader_gid, _base, run_root, identity_root = self._roots(inputs)
        current, raw = self._current_identity(identity_root, reader_gid, required=True)
        if self._load_transaction(identity_root, reader_gid) is not None:
            reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_TRANSACTION_BUSY")
        if run_root.exists():
            self._run_root(run_root.parent, run_root, create=False)
            if set(os.listdir(run_root)) != {RELEASE_ARTIFACT_MARKER}:
                reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_TARGET_CONFLICT")
        return {
            "reader_gid": reader_gid,
            "current_identity_sha256": hashlib.sha256(raw or b"").hexdigest(),
            "current_release_id": current["release_id"] if current else None,
        }

    def publish(
            self, inputs: CapabilityInputs, documents: dict[str, Any],
    ) -> dict[str, Any]:
        documents = self._validated_documents(documents)
        reader_gid, base, run_root, identity_root = self._roots(inputs)
        self._run_root(base, run_root, create=True)
        run_id = documents["receipt"]["run_id"]
        if run_root.name != run_id:
            reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_DOCUMENT_INVALID")
        prepared = run_root / f".{run_id}.postdeploy-receipt.prepared.json"
        published = run_root / f"{run_id}.postdeploy-receipt.json"
        allowed = {RELEASE_ARTIFACT_MARKER, prepared.name, published.name}
        if not set(os.listdir(run_root)).issubset(allowed):
            reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_TARGET_CONFLICT")
        current, current_raw = self._current_identity(
            identity_root, reader_gid, required=True,
        )
        assert current is not None and current_raw is not None
        if current == documents["identity"]:
            return self.read_published(inputs, expected=documents)
        try:
            current_time = datetime.strptime(
                current["generated_at"], "%Y-%m-%dT%H:%M:%S.%fZ",
            )
            candidate_time = datetime.strptime(
                documents["identity"]["generated_at"], "%Y-%m-%dT%H:%M:%S.%fZ",
            )
        except ValueError:
            reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_IDENTITY_INVALID")
        if candidate_time <= current_time:
            reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_GENERATION_INVALID")
        if published.exists():
            reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_PARTIAL")
        if prepared.exists():
            receipt, raw = self._read_json(
                prepared, validate_postdeploy_receipt_document, gid=0,
                maximum=MAX_JSON_BYTES,
                code="ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_RECEIPT_INVALID",
            )
            if receipt != documents["receipt"] or raw != canonical(documents["receipt"]):
                reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_TARGET_CONFLICT")
        else:
            self._write_file(
                prepared, canonical(documents["receipt"]), gid=0,
                mode=self.RECEIPT_MODE, replace=False,
                code="ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_RECEIPT_INVALID",
            )
        self._fault("AFTER_ROLLBACK_RECEIPT_PREPARED")
        previous_sha256 = hashlib.sha256(current_raw).hexdigest()
        self._prepare_transaction(
            identity_root, reader_gid, documents, previous_sha256,
        )
        try:
            os.rename(prepared, published)
            self._sync(run_root, "ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_RECEIPT_INVALID")
        except OSError:
            reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_RECEIPT_INVALID")
        self._fault("AFTER_ROLLBACK_RECEIPT_PUBLISHED")
        current_again, current_again_raw = self._current_identity(
            identity_root, reader_gid, required=True,
        )
        if current_again != current \
                or hashlib.sha256(current_again_raw or b"").hexdigest() != previous_sha256:
            reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_IDENTITY_DRIFT")
        self._write_file(
            identity_root / "release-identity.json", canonical(documents["identity"]),
            gid=reader_gid, mode=self.RECEIPT_MODE, replace=True,
            code="ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_IDENTITY_INVALID",
        )
        self._fault("AFTER_ROLLBACK_IDENTITY_REPLACED")
        result = self.read_published(inputs, expected=documents, allow_transaction=True)
        self._remove_transaction(identity_root, reader_gid)
        self._fault("AFTER_ROLLBACK_PUBLICATION_COMMITTED")
        return self.read_published(inputs, expected=result)

    def recover_published(self, inputs: CapabilityInputs) -> dict[str, Any]:
        """Finish only an exact, durably prepared publication transaction."""
        reader_gid, base, run_root, identity_root = self._roots(inputs)
        self._run_root(base, run_root, create=False)
        run_id = inputs.plan["targets"]["rollback_postdeploy_run_id"]
        prepared = run_root / f".{run_id}.postdeploy-receipt.prepared.json"
        published = run_root / f"{run_id}.postdeploy-receipt.json"
        entries = set(os.listdir(run_root))
        prepared_entries = {RELEASE_ARTIFACT_MARKER, prepared.name}
        published_entries = {RELEASE_ARTIFACT_MARKER, published.name}
        if entries == prepared_entries:
            receipt, receipt_raw = self._read_json(
                prepared, validate_postdeploy_receipt_document, gid=0,
                maximum=MAX_JSON_BYTES,
                code="ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_RECEIPT_INVALID",
            )
            return self.publish(
                inputs, self._documents_from_receipt(receipt, receipt_raw),
            )
        if entries != published_entries:
            reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_PARTIAL")
        receipt, receipt_raw = self._read_json(
            published, validate_postdeploy_receipt_document, gid=0,
            maximum=MAX_JSON_BYTES,
            code="ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_RECEIPT_INVALID",
        )
        documents = self._documents_from_receipt(receipt, receipt_raw)
        transaction = self._load_transaction(identity_root, reader_gid)
        if transaction is None:
            return self.read_published(inputs, expected=documents)
        if transaction["candidate"] != documents["identity"] \
                or transaction["metadata"]["candidate_sha256"] \
                    != documents["identity_sha256"]:
            reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_TRANSACTION_INVALID")
        current, current_raw = self._current_identity(
            identity_root, reader_gid, required=True,
        )
        assert current is not None and current_raw is not None
        if current != documents["identity"]:
            if hashlib.sha256(current_raw).hexdigest() \
                    != transaction["metadata"]["previous_sha256"]:
                reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_IDENTITY_DRIFT")
            self._write_file(
                identity_root / "release-identity.json",
                canonical(documents["identity"]), gid=reader_gid,
                mode=self.RECEIPT_MODE, replace=True,
                code="ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_IDENTITY_INVALID",
            )
        committed = self.read_published(
            inputs, expected=documents, allow_transaction=True,
        )
        self._remove_transaction(identity_root, reader_gid)
        return self.read_published(inputs, expected=committed)

    def read_published(
            self, inputs: CapabilityInputs, *, expected: dict[str, Any] | None = None,
            allow_transaction: bool = False,
    ) -> dict[str, Any]:
        reader_gid, _base, run_root, identity_root = self._roots(inputs)
        self._run_root(run_root.parent, run_root, create=False)
        run_id = inputs.plan["targets"]["rollback_postdeploy_run_id"]
        published = run_root / f"{run_id}.postdeploy-receipt.json"
        if set(os.listdir(run_root)) != {RELEASE_ARTIFACT_MARKER, published.name}:
            reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_PARTIAL")
        transaction = self._load_transaction(identity_root, reader_gid)
        if transaction is not None and not allow_transaction:
            reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_PARTIAL")
        receipt, receipt_raw = self._read_json(
            published, validate_postdeploy_receipt_document, gid=0,
            maximum=MAX_JSON_BYTES,
            code="ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_RECEIPT_INVALID",
        )
        identity, identity_raw = self._current_identity(
            identity_root, reader_gid, required=True,
        )
        assert identity is not None and identity_raw is not None
        result = self._validated_documents({
            "receipt": receipt,
            "receipt_sha256": hashlib.sha256(receipt_raw).hexdigest(),
            "receipt_json": receipt_raw.decode("utf-8"),
            "identity": identity,
            "identity_sha256": hashlib.sha256(identity_raw).hexdigest(),
            "identity_json": identity_raw.decode("utf-8"),
        })
        if identity["postdeploy_receipt_sha256"] != result["receipt_sha256"]:
            reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_BINDING_INVALID")
        if expected is not None and result != self._validated_documents(expected):
            reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_BINDING_INVALID")
        return result


def build_rollback_release_documents(
        inputs: CapabilityInputs, observation: dict[str, Any], *,
        runtime_configuration_sha256: str, generated_at: str,
        readiness: dict[str, Any],
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_RELEASE_EVIDENCE_INVALID"
    if not SHA256.fullmatch(runtime_configuration_sha256 or "") \
            or not ISO_UTC.fullmatch(generated_at or ""):
        reject(code)
    try:
        plan = inputs.plan
        package = inputs.package
        predecessor = package["predecessor"]
        source_receipt = validate_postdeploy_receipt_document(
            inputs.json("predecessor_postdeploy_receipt"),
        )
        manifest = inputs.json("predecessor_release_manifest")
        source = package["sources"]
        context = inputs.context
        authorization = inputs.request["payload"]["record_intent"][
            "execution_authorization_sha256"
        ]
    except (KeyError, TypeError, FixedExecutorError):
        reject(code)
    if not SHA256.fullmatch(
            source.get("predecessor_postdeploy_receipt", {}).get("sha256") or "",
    ) or source["predecessor_release_manifest"]["sha256"] \
                != predecessor.get("release_manifest_sha256") \
            or source_receipt["release"]["manifest_sha256"] \
                != predecessor.get("release_manifest_sha256") \
            or source_receipt["source"] != {
                "application_version": predecessor.get("application_version"),
                "git_commit": predecessor.get("git_commit"),
                "git_tree": predecessor.get("git_tree"),
            } or source_receipt["migrations"] != {
                "head": predecessor.get("migration_head"),
                "manifest_sha256": predecessor.get("migration_manifest_sha256"),
            } or not isinstance(manifest, dict) \
            or manifest.get("release_id") != source_receipt["release"]["release_id"] \
            or manifest.get("source", {}).get("package_version") \
                != predecessor.get("application_version") \
            or manifest.get("source", {}).get("git_commit") != predecessor.get("git_commit") \
            or manifest.get("source", {}).get("git_tree") != predecessor.get("git_tree") \
            or manifest.get("migrations", {}).get("head") \
                != predecessor.get("migration_head") \
            or manifest.get("migrations", {}).get("allowlist_sha256") \
                != predecessor.get("migration_manifest_sha256"):
        reject(code)
    services_by_name = {
        item["service"]: item for item in observation.get("services", [])
    }
    if set(services_by_name) != {"caddy", "postgres", "web", "worker"}:
        reject(code)
    receipt_services: list[dict[str, Any]] = []
    for name in ("caddy", "postgres", "web", "worker"):
        item = services_by_name[name]
        image_id = item["image_config_digest"] if name in {"caddy", "postgres"} \
            else "sha256:" + item["image_reference"].rsplit("@sha256:", 1)[-1]
        receipt_services.append({
            "service": name, "container_id": item["container_id"],
            "image_id": image_id, "image_reference": item["image_reference"],
            "restart_count": 0, "oom_killed": False, "running": True,
            "restarting": False, "paused": False, "dead": False, "status": "running",
            "health": item["health"],
            "healthcheck_present": item["healthcheck_present"],
        })
    readiness = validate_postdeploy_readiness_document(readiness, code)
    if readiness != {
        "deployment_class": "UAT", "deployment_id": "chenyida-erp",
        "version": predecessor["application_version"],
        "revision": predecessor["git_commit"][:12],
        "migration_head": predecessor["migration_head"],
        "migration_manifest_sha256": predecessor["migration_manifest_sha256"],
        "database_time": readiness["database_time"],
        "components": {
            "postgresql": "READY", "migration": "READY", "worker": "READY",
            "uploads": "READY", "attachments": "READY", "runtime": "READY",
        },
    }:
        reject(code)
    receipt = validate_postdeploy_receipt_document({
        "schema_version": 1, "contract": "chenyida-erp-postdeploy-verification/v1",
        "run_id": plan["targets"]["rollback_postdeploy_run_id"],
        "generated_at": generated_at, "result": "PASS",
        "runtime_guard": dict(POST_DEPLOY_RUNTIME_GUARD),
        "control": {
            "supervisor_bundle_sha256": context["supervisor_bundle_sha256"],
            "authorization_sha256": authorization,
        },
        "deployment": {"class": "UAT", "id": "chenyida-erp", "compose_project": "chenyida-erp"},
        "release": dict(source_receipt["release"]),
        "source": dict(source_receipt["source"]),
        "migrations": dict(source_receipt["migrations"]),
        "runtime_policy_sha256": RELEASE_RUNTIME_POLICY_SHA256,
        "runtime_configuration_sha256": runtime_configuration_sha256,
        "services": receipt_services,
        "readiness": readiness,
    })
    receipt_sha256 = digest_value(receipt)
    service = {item["service"]: item for item in receipt_services}
    identity = validate_release_identity_document({
        "schema_version": 3, "contract": "chenyida-erp-runtime-release-identity/v3",
        "deployment_class": "UAT", "deployment_id": "chenyida-erp",
        "release_id": receipt["release"]["release_id"],
        "release_manifest_sha256": receipt["release"]["manifest_sha256"],
        "postdeploy_receipt_sha256": receipt_sha256,
        "supervisor_bundle_sha256": receipt["control"]["supervisor_bundle_sha256"],
        "authorization_sha256": receipt["control"]["authorization_sha256"],
        "runtime_guard": dict(POST_DEPLOY_RUNTIME_GUARD),
        "runtime_policy_sha256": RELEASE_RUNTIME_POLICY_SHA256,
        "application_version": receipt["source"]["application_version"],
        "git_commit": receipt["source"]["git_commit"],
        "git_tree": receipt["source"]["git_tree"],
        "migration_head": receipt["migrations"]["head"],
        "migration_manifest_sha256": receipt["migrations"]["manifest_sha256"],
        **{f"{name}_container_id": service[name]["container_id"]
           for name in ("caddy", "postgres", "web", "worker")},
        **{f"{name}_image_digest": service[name]["image_id"]
           for name in ("caddy", "postgres", "web", "worker")},
        "generated_at": generated_at,
    })
    return {
        "receipt": receipt, "receipt_sha256": receipt_sha256,
        "receipt_json": canonical(receipt).decode("utf-8"),
        "identity": identity, "identity_sha256": digest_value(identity),
        "identity_json": canonical(identity).decode("utf-8"),
    }


def render_pg_sql(
        base: dict[str, Any], opcode: str, bindings: dict[str, Any],
) -> bytes:
    """Render a closed SQL opcode; SQL, database, argv and timeout are never caller fields."""
    base = validate_pg_rollback_base_spec(base)
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_OPCODE_SPEC_INVALID"
    if opcode not in POSTGRES_SQL_OPCODES:
        reject(code)
    fields = {
        "PG_RB_CREATE_STAGING_V1": {
            "capacity_receipt_sha256", "before_observation_sha256",
            "expected_staging_identity_sha256",
        },
        "PG_RB_OBSERVE_STATE_V1": {
            "journal_state_sha256", "observation_scope_sha256",
        },
        "PG_RB_OBSERVE_STAGING_RESTORE_PRECONDITION_V1": {
            "create_receipt_sha256", "staging_oid", "dump_inventory_sha256",
            "expected_empty_projection_sha256",
        },
        "PG_RB_ATOMIC_SWITCH_V1": {
            "privilege_receipt_sha256", "staging_oid", "before_observation_sha256",
            "staging_content_proof_sha256",
            "expected_switched_identity_sha256",
        },
        "PG_RB_UNSEAL_ACTIVE_V1": {
            "switch_receipt_sha256", "active_oid", "activation_prerequisites_sha256",
            "sealed_security_projection_sha256", "before_observation_sha256",
            "expected_released_identity_sha256",
        },
    }[opcode]
    bindings = exact(bindings, fields, code)
    for field, value in bindings.items():
        if field.endswith("_sha256") and (
            not isinstance(value, str) or SHA256.fullmatch(value) is None or value == ZERO_SHA256
        ):
            reject(code)
        if field.endswith("_oid") and (
            not isinstance(value, str) or OID.fullmatch(value) is None
        ):
            reject(code)
    postgres = base["postgres"]
    databases = base["databases"]
    profile = base["profile"]
    active = _pg_identifier(databases["active_name"])
    staging = _pg_identifier(databases["staging_name"])
    quarantine = _pg_identifier(databases["quarantine_name"])
    active_name = _pg_literal(databases["active_name"])
    staging_name = _pg_literal(databases["staging_name"])
    quarantine_name = _pg_literal(databases["quarantine_name"])
    system_identifier = _pg_literal(postgres["system_identifier"])
    candidate_oid = _pg_literal(databases["candidate_oid"])
    candidate_marker = _pg_literal(databases["candidate_marker"])
    staging_marker = _pg_literal(databases["staging_marker"])
    quarantine_marker = _pg_literal(databases["quarantine_marker"])
    lock_name = _pg_literal(f"chenyida-erp-uat-rollback:{base['runtime_plan_sha256']}")
    if opcode == "PG_RB_CREATE_STAGING_V1":
        collation = "" if profile["collation_version"] is None else \
            f" COLLATION_VERSION {_pg_literal(profile['collation_version'])}"
        sql = f"""SELECT pg_catalog.pg_advisory_lock(pg_catalog.hashtextextended({lock_name},0));
DO $cyd$
BEGIN
  IF (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> {system_identifier}
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_database
       WHERE datname={active_name} AND oid::text={candidate_oid}
         AND pg_catalog.shobj_description(oid,'pg_database')={candidate_marker}
     )
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname IN ({staging_name},{quarantine_name}))
  THEN RAISE EXCEPTION 'rollback create precondition mismatch'; END IF;
END
$cyd$;
CREATE DATABASE {staging} WITH OWNER postgres TEMPLATE template0
  ENCODING {_pg_literal(profile['encoding'])}
  LOCALE_PROVIDER libc
  LC_COLLATE {_pg_literal(profile['collate'])}
  LC_CTYPE {_pg_literal(profile['ctype'])}{collation}
  TABLESPACE pg_default CONNECTION LIMIT 0;
COMMENT ON DATABASE {staging} IS {staging_marker};
ALTER DATABASE {staging} SET default_transaction_read_only TO 'on';
SELECT pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended({lock_name},0));
"""
    elif opcode == "PG_RB_OBSERVE_STATE_V1":
        sql = f"""SELECT pg_catalog.json_build_object(
  'system_identifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
  'server_version_num',current_setting('server_version_num'),
  'databases',COALESCE((
    SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
      'name',d.datname,'oid',d.oid::text,
      'marker',pg_catalog.shobj_description(d.oid,'pg_database'),
      'allow_connections',d.datallowconn,'connection_limit',d.datconnlimit,
      'default_transaction_read_only',EXISTS(
        SELECT 1 FROM pg_catalog.pg_db_role_setting s
        WHERE s.setdatabase=d.oid AND s.setrole=0
          AND 'default_transaction_read_only=on'=ANY(s.setconfig)),
      'sessions',(SELECT count(*) FROM pg_catalog.pg_stat_activity a WHERE a.datid=d.oid),
      'prepared_xacts',(SELECT count(*) FROM pg_catalog.pg_prepared_xacts x WHERE x.database=d.datname)
    ) ORDER BY d.datname)
    FROM pg_catalog.pg_database d
    WHERE d.datname IN ({active_name},{staging_name},{quarantine_name})
  ),'[]'::json)
)::text;
"""
    elif opcode == "PG_RB_OBSERVE_STAGING_RESTORE_PRECONDITION_V1":
        staging_oid = _pg_literal(bindings["staging_oid"])
        sql = f"""WITH target AS (
  SELECT d.*,c.system_identifier::text AS system_identifier
  FROM pg_catalog.pg_database d CROSS JOIN pg_catalog.pg_control_system() c
  WHERE d.datname=current_database() AND d.oid::text={staging_oid}
), projection AS (
  SELECT
    (SELECT count(*)::integer FROM pg_catalog.pg_namespace n
     WHERE n.nspname NOT IN ('pg_catalog','information_schema','public')
       AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%')
      AS user_schema_count,
    (SELECT count(*)::integer FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname NOT IN ('pg_catalog','information_schema')
       AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
       AND c.relkind IN ('r','p','v','m','f')) AS relation_count,
    (SELECT count(*)::integer FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname NOT IN ('pg_catalog','information_schema')
       AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
       AND c.relkind='S') AS sequence_count,
    (SELECT count(*)::integer FROM pg_catalog.pg_proc p
     JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog','information_schema')
       AND n.nspname NOT LIKE 'pg_temp_%') AS routine_count,
    (SELECT count(*)::integer FROM pg_catalog.pg_type t
     JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
     WHERE n.nspname NOT IN ('pg_catalog','information_schema')
       AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
       AND t.typrelid=0 AND t.typelem=0) AS standalone_type_count,
    (SELECT count(*)::integer FROM pg_catalog.pg_extension e
     WHERE e.extname<>'plpgsql') AS unexpected_extension_count,
    (SELECT count(*)::integer FROM pg_catalog.pg_largeobject_metadata)
      AS large_object_count,
    (pg_catalog.to_regclass('public.schema_migrations') IS NOT NULL)
      AS schema_migrations_present
)
SELECT pg_catalog.jsonb_build_object(
  'system_identifier',target.system_identifier,
  'server_version_num',current_setting('server_version_num'),
  'database',pg_catalog.jsonb_build_object(
    'name',target.datname,'oid',target.oid::text,
    'marker',pg_catalog.shobj_description(target.oid,'pg_database'),
    'owner',pg_catalog.pg_get_userbyid(target.datdba),
    'allow_connections',target.datallowconn,'connection_limit',target.datconnlimit,
    'default_transaction_read_only',EXISTS(
      SELECT 1 FROM pg_catalog.pg_db_role_setting s
      WHERE s.setdatabase=target.oid AND s.setrole=0
        AND 'default_transaction_read_only=on'=ANY(s.setconfig)),
    'sessions',(SELECT count(*)::integer FROM pg_catalog.pg_stat_activity a
                WHERE a.datid=target.oid AND a.pid<>pg_catalog.pg_backend_pid()),
    'prepared_xacts',(SELECT count(*)::integer FROM pg_catalog.pg_prepared_xacts x
                      WHERE x.database=target.datname)),
  'profile',pg_catalog.jsonb_build_object(
    'encoding',pg_catalog.pg_encoding_to_char(target.encoding),
    'locale_provider',CASE target.datlocprovider WHEN 'c' THEN 'libc'
      WHEN 'i' THEN 'icu' WHEN 'b' THEN 'builtin' ELSE 'unknown' END,
    'collate',target.datcollate,'ctype',target.datctype,
    'collation_version',target.datcollversion,
    'tablespace',(SELECT t.spcname FROM pg_catalog.pg_tablespace t
                  WHERE t.oid=target.dattablespace)),
  'projection',pg_catalog.to_jsonb(projection)
)::text
FROM target CROSS JOIN projection;
"""
    elif opcode == "PG_RB_ATOMIC_SWITCH_V1":
        staging_oid = _pg_literal(bindings["staging_oid"])
        sql = f"""BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended({lock_name},0));
DO $cyd$
BEGIN
  IF (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> {system_identifier}
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_database d
       WHERE d.datname={active_name} AND d.oid::text={candidate_oid}
         AND pg_catalog.shobj_description(d.oid,'pg_database')={candidate_marker}
         AND d.datallowconn=false AND d.datconnlimit=0)
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_database d
       WHERE d.datname={staging_name} AND d.oid::text={staging_oid}
         AND pg_catalog.shobj_description(d.oid,'pg_database')={staging_marker}
         AND d.datallowconn=true AND d.datconnlimit=0
         AND EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s
           WHERE s.setdatabase=d.oid AND s.setrole=0
             AND 'default_transaction_read_only=on'=ANY(s.setconfig)))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname={quarantine_name})
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity
                WHERE datname IN ({active_name},{staging_name},{quarantine_name}))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_prepared_xacts
                WHERE database IN ({active_name},{staging_name},{quarantine_name}))
  THEN RAISE EXCEPTION 'rollback switch precondition mismatch'; END IF;
END
$cyd$;
ALTER DATABASE {staging} ALLOW_CONNECTIONS false;
ALTER DATABASE {active} RENAME TO {quarantine};
ALTER DATABASE {staging} RENAME TO {active};
COMMENT ON DATABASE {quarantine} IS {quarantine_marker};
COMMENT ON DATABASE {active} IS {candidate_marker};
COMMIT;
"""
    else:
        active_oid = _pg_literal(bindings["active_oid"])
        sql = f"""BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended({lock_name},0));
DO $cyd$
BEGIN
  IF (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> {system_identifier}
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_database d
       WHERE d.datname={active_name} AND d.oid::text={active_oid}
         AND pg_catalog.shobj_description(d.oid,'pg_database')={candidate_marker}
         AND d.datallowconn=false AND d.datconnlimit=0
         AND EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s
           WHERE s.setdatabase=d.oid AND s.setrole=0
             AND 'default_transaction_read_only=on'=ANY(s.setconfig)))
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_database d
       WHERE d.datname={quarantine_name} AND d.oid::text={candidate_oid}
         AND pg_catalog.shobj_description(d.oid,'pg_database')={quarantine_marker}
         AND d.datallowconn=false AND d.datconnlimit=0)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname={staging_name})
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity
                WHERE datname IN ({active_name},{staging_name},{quarantine_name}))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_prepared_xacts
                WHERE database IN ({active_name},{staging_name},{quarantine_name}))
  THEN RAISE EXCEPTION 'rollback unseal precondition mismatch'; END IF;
END
$cyd$;
ALTER DATABASE {active} ALLOW_CONNECTIONS true;
ALTER DATABASE {active} CONNECTION LIMIT 64;
ALTER DATABASE {active} RESET default_transaction_read_only;
COMMENT ON DATABASE {active} IS {candidate_marker};
COMMIT;
"""
    raw = sql.encode("utf-8")
    if not raw.endswith(b"\n") or len(raw) > base["runtime_limits"]["sql_max_bytes"]:
        reject(code)
    return raw


def derive_pg_opcode_spec(
        base: dict[str, Any], opcode: str, bindings: dict[str, Any],
) -> dict[str, Any]:
    base = validate_pg_rollback_base_spec(base)
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_OPCODE_SPEC_INVALID"
    if opcode not in POSTGRES_SQL_OPCODES:
        reject(code)
    raw = render_pg_sql(base, opcode, bindings)
    phase = {
        "PG_RB_CREATE_STAGING_V1": "create",
        "PG_RB_OBSERVE_STATE_V1": "observe",
        "PG_RB_OBSERVE_STAGING_RESTORE_PRECONDITION_V1": "restoreprecondition",
        "PG_RB_ATOMIC_SWITCH_V1": "switch",
        "PG_RB_UNSEAL_ACTIVE_V1": "unseal",
    }[opcode]
    effectful = opcode not in POSTGRES_READ_ONLY_SQL_OPCODES
    database = base["databases"]["staging_name"] \
        if opcode == "PG_RB_OBSERVE_STAGING_RESTORE_PRECONDITION_V1" \
        else base["postgres"]["management_database"]
    body = {
        "schema_version": 1,
        "contract": POSTGRES_OPCODE_SPEC_CONTRACT,
        "opcode": opcode,
        "base_spec_sha256": base["base_spec_sha256"],
        "database": database,
        "phase": phase,
        "timeout_seconds": 300,
        "effectful": effectful,
        "bindings": bindings,
        "sql_sha256": hashlib.sha256(raw).hexdigest(),
        "argv_template_sha256": digest_value([
            "DOCKER_EXEC_POSTGRES_PSQL_V1", base["postgres"]["container_id"],
            database, phase,
        ]),
    }
    return validate_pg_opcode_spec(
        {**body, "opcode_spec_sha256": digest_value(body)}, base=base,
    )


def validate_pg_opcode_spec(
        value: Any, *, base: dict[str, Any],
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_OPCODE_SPEC_INVALID"
    base = validate_pg_rollback_base_spec(base)
    spec = exact(value, {
        "schema_version", "contract", "opcode", "base_spec_sha256", "database", "phase",
        "timeout_seconds", "effectful", "bindings", "sql_sha256",
        "argv_template_sha256", "opcode_spec_sha256",
    }, code)
    if spec.get("schema_version") != 1 or spec.get("contract") != POSTGRES_OPCODE_SPEC_CONTRACT \
            or spec.get("opcode") not in POSTGRES_SQL_OPCODES \
            or spec.get("base_spec_sha256") != base["base_spec_sha256"] \
            or spec.get("database") != (
                base["databases"]["staging_name"]
                if spec.get("opcode") == "PG_RB_OBSERVE_STAGING_RESTORE_PRECONDITION_V1"
                else base["postgres"]["management_database"]
            ) \
            or spec.get("timeout_seconds") != 300 \
            or spec.get("effectful") != (
                spec["opcode"] not in POSTGRES_READ_ONLY_SQL_OPCODES
            ) \
            or any(not SHA256.fullmatch(spec.get(field) or "") for field in (
                "sql_sha256", "argv_template_sha256", "opcode_spec_sha256",
            )) \
            or digest_value(without(spec, "opcode_spec_sha256")) \
                != spec["opcode_spec_sha256"]:
        reject(code)
    expected_phase = {
        "PG_RB_CREATE_STAGING_V1": "create",
        "PG_RB_OBSERVE_STATE_V1": "observe",
        "PG_RB_OBSERVE_STAGING_RESTORE_PRECONDITION_V1": "restoreprecondition",
        "PG_RB_ATOMIC_SWITCH_V1": "switch",
        "PG_RB_UNSEAL_ACTIVE_V1": "unseal",
    }[spec["opcode"]]
    if spec.get("phase") != expected_phase:
        reject(code)
    raw = render_pg_sql(base, spec["opcode"], spec.get("bindings"))
    if hashlib.sha256(raw).hexdigest() != spec["sql_sha256"] \
            or digest_value([
                "DOCKER_EXEC_POSTGRES_PSQL_V1", base["postgres"]["container_id"],
                spec["database"], expected_phase,
            ]) != spec["argv_template_sha256"]:
        reject(code)
    return spec


def derive_pg_dump_opcode_spec(
        base: dict[str, Any], opcode: str, bindings: dict[str, Any],
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_DUMP_OPCODE_SPEC_INVALID"
    base = validate_pg_rollback_base_spec(base)
    fields = {
        "PG_RB_LIST_DUMP_V1": {"dump_sha256", "dump_bytes"},
        "PG_RB_RESTORE_DUMP_V1": {
            "create_receipt_sha256", "staging_oid", "before_content_observation_sha256",
            "dump_inventory_sha256", "restore_precondition_opcode_spec_sha256",
            "restore_precondition_sha256", "empty_projection_sha256",
            "dump_sha256", "dump_bytes", "expected_content_sha256",
        },
    }
    if opcode not in fields:
        reject(code)
    bindings = exact(bindings, fields[opcode], code)
    if bindings.get("dump_sha256") != base["snapshot"]["dump_sha256"] \
            or bindings.get("dump_bytes") != base["snapshot"]["dump_bytes"] \
            or any(not SHA256.fullmatch(bindings.get(field) or "")
                   or bindings[field] == ZERO_SHA256
                   for field in bindings if field.endswith("_sha256")) \
            or "staging_oid" in bindings \
                and OID.fullmatch(bindings.get("staging_oid") or "") is None \
            or opcode == "PG_RB_RESTORE_DUMP_V1" \
                and bindings.get("empty_projection_sha256") \
                    != digest_value(postgres_empty_restore_projection()):
        reject(code)
    restore = opcode == "PG_RB_RESTORE_DUMP_V1"
    database = base["databases"]["staging_name"] if restore else None
    phase = "restore" if restore else "list"
    timeout = 1800 if restore else 300
    argv = [
        "DOCKER_EXEC_POSTGRES_PG_RESTORE_V1", base["postgres"]["container_id"],
        database, phase, "CUSTOM_DUMP_FD", "NO_OWNER", "NO_ACL", "NO_TABLESPACES",
        *(["SESSION_READ_WRITE_OVERRIDE_FIXED"] if restore else []),
        "SINGLE_TRANSACTION" if restore else "LIST_ONLY",
    ]
    body = {
        "schema_version": 1,
        "contract": POSTGRES_DUMP_OPCODE_SPEC_CONTRACT,
        "opcode": opcode,
        "base_spec_sha256": base["base_spec_sha256"],
        "database": database,
        "phase": phase,
        "timeout_seconds": timeout,
        "effectful": restore,
        "bindings": bindings,
        "argv_template_sha256": digest_value(argv),
    }
    return validate_pg_dump_opcode_spec(
        {**body, "opcode_spec_sha256": digest_value(body)}, base=base,
    )


def validate_pg_dump_opcode_spec(
        value: Any, *, base: dict[str, Any],
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_DUMP_OPCODE_SPEC_INVALID"
    base = validate_pg_rollback_base_spec(base)
    spec = exact(value, {
        "schema_version", "contract", "opcode", "base_spec_sha256", "database", "phase",
        "timeout_seconds", "effectful", "bindings", "argv_template_sha256",
        "opcode_spec_sha256",
    }, code)
    if spec.get("schema_version") != 1 \
            or spec.get("contract") != POSTGRES_DUMP_OPCODE_SPEC_CONTRACT \
            or spec.get("opcode") not in {"PG_RB_LIST_DUMP_V1", "PG_RB_RESTORE_DUMP_V1"} \
            or spec.get("base_spec_sha256") != base["base_spec_sha256"] \
            or any(not SHA256.fullmatch(spec.get(field) or "") for field in (
                "argv_template_sha256", "opcode_spec_sha256",
            )) \
            or digest_value(without(spec, "opcode_spec_sha256")) \
                != spec["opcode_spec_sha256"]:
        reject(code)
    expected = derive_pg_dump_opcode_spec_body(base, spec["opcode"], spec.get("bindings"))
    if any(spec.get(field) != expected[field] for field in (
        "database", "phase", "timeout_seconds", "effectful", "argv_template_sha256",
    )):
        reject(code)
    return spec


def derive_pg_dump_opcode_spec_body(
        base: dict[str, Any], opcode: str, bindings: Any,
) -> dict[str, Any]:
    """Validate dump bindings and return fixed dispatch fields without recursive hashing."""
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_DUMP_OPCODE_SPEC_INVALID"
    fields = {
        "PG_RB_LIST_DUMP_V1": {"dump_sha256", "dump_bytes"},
        "PG_RB_RESTORE_DUMP_V1": {
            "create_receipt_sha256", "staging_oid", "before_content_observation_sha256",
            "dump_inventory_sha256", "restore_precondition_opcode_spec_sha256",
            "restore_precondition_sha256", "empty_projection_sha256",
            "dump_sha256", "dump_bytes", "expected_content_sha256",
        },
    }
    if opcode not in fields:
        reject(code)
    bindings = exact(bindings, fields[opcode], code)
    if bindings.get("dump_sha256") != base["snapshot"]["dump_sha256"] \
            or bindings.get("dump_bytes") != base["snapshot"]["dump_bytes"] \
            or any(not SHA256.fullmatch(bindings.get(field) or "")
                   or bindings[field] == ZERO_SHA256
                   for field in bindings if field.endswith("_sha256")) \
            or "staging_oid" in bindings \
                and OID.fullmatch(bindings.get("staging_oid") or "") is None \
            or opcode == "PG_RB_RESTORE_DUMP_V1" \
                and bindings.get("empty_projection_sha256") \
                    != digest_value(postgres_empty_restore_projection()):
        reject(code)
    restore = opcode == "PG_RB_RESTORE_DUMP_V1"
    database = base["databases"]["staging_name"] if restore else None
    phase = "restore" if restore else "list"
    return {
        "database": database,
        "phase": phase,
        "timeout_seconds": 1800 if restore else 300,
        "effectful": restore,
        "argv_template_sha256": digest_value([
            "DOCKER_EXEC_POSTGRES_PG_RESTORE_V1", base["postgres"]["container_id"],
            database, phase, "CUSTOM_DUMP_FD", "NO_OWNER", "NO_ACL", "NO_TABLESPACES",
            *(["SESSION_READ_WRITE_OVERRIDE_FIXED"] if restore else []),
            "SINGLE_TRANSACTION" if restore else "LIST_ONLY",
        ]),
    }


def _pg_qualified(identity: str) -> str:
    if not isinstance(identity, str):
        reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_RECONCILIATION_INVALID")
    parts = identity.split(".")
    if len(parts) != 2:
        reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_RECONCILIATION_INVALID")
    return f"{_pg_identifier(parts[0])}.{_pg_identifier(parts[1])}"


def _pg_routine(identity: str) -> str:
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_RECONCILIATION_INVALID"
    if not isinstance(identity, str):
        reject(code)
    matched = re.fullmatch(r"public\.([a-z_][a-z0-9_]*)\((.*)\)", identity)
    argument = re.compile(
        r"(?:public\.[a-z_][a-z0-9_]*|[a-z_][a-z0-9_]*(?: [a-z_][a-z0-9_]*)*)(?:\[\])?\Z",
    )
    if matched is None or matched.group(2) and any(
        argument.fullmatch(item) is None for item in matched.group(2).split(",")
    ):
        reject(code)
    return f'public.{_pg_identifier(matched.group(1))}({matched.group(2)})'


def render_pg_reconciliation_sql(
        base: dict[str, Any], inputs: CapabilityInputs, bindings: dict[str, Any],
) -> bytes:
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_RECONCILIATION_INVALID"
    base = validate_pg_rollback_base_spec(base)
    if derive_pg_rollback_base_spec(inputs)["base_spec_sha256"] != base["base_spec_sha256"]:
        reject(code)
    bindings = exact(bindings, {
        "restore_receipt_sha256", "staging_oid", "baseline_security_sha256",
        "authority_activation_sha256", "desired_sealed_security_sha256",
    }, code)
    if any(not SHA256.fullmatch(bindings.get(field) or "")
           or bindings[field] == ZERO_SHA256
           for field in bindings if field.endswith("_sha256")) \
            or not OID.fullmatch(bindings.get("staging_oid") or "") \
            or bindings.get("desired_sealed_security_sha256") \
                != digest_value(base["security"]):
        reject(code)
    access = inputs.json("snapshot_runtime_privilege_access")
    catalog_document = inputs.json("snapshot_runtime_privilege_compiled_catalog")
    policy = inputs.json("snapshot_runtime_privilege_policy")
    catalog = catalog_document.get("catalog")
    if not isinstance(catalog, dict) or not isinstance(catalog.get("unsupported"), dict) \
            or any(isinstance(value, bool) or not isinstance(value, int) or value != 0
                   for value in catalog["unsupported"].values()):
        reject(code)
    constraints = policy.get("object_constraints")
    tablespaces = policy.get("tablespaces")
    if not isinstance(constraints, dict) or any(constraints.get(field) != 0 for field in (
        "column_acl_count", "custom_tablespace_count", "large_object_count",
    )) or constraints.get("grant_option_allowed") is not False \
            or constraints.get("direct_login_acl_allowed") is not False \
            or constraints.get("public_object_privileges") != [] \
            or constraints.get("unknown_acl_endpoints") != "FAIL_CLOSED" \
            or constraints.get("unknown_managed_roles") != "FAIL_CLOSED" \
            or constraints.get("unknown_memberships") != "FAIL_CLOSED" \
            or not isinstance(tablespaces, dict) or tablespaces.get("custom") != [] \
            or tablespaces.get("privileges") != []:
        reject(code)
    roles = policy.get("roles")
    memberships = policy.get("memberships")
    identities = policy.get("identities")
    service_bindings = policy.get("service_bindings")
    access_services = access.get("services")
    expected_default_privileges = [
        {
            "owner": "chenyida_erp_owner", "scope": "SCHEMA", "schema": "public",
            "object_kind": "SEQUENCE", "owner_privileges": ["SELECT", "UPDATE", "USAGE"],
            "public_privileges": [], "privilege_group_privileges": [],
            "materialized_row_required": False,
        },
        {
            "owner": "chenyida_erp_owner", "scope": "SCHEMA", "schema": "public",
            "object_kind": "TABLE",
            "owner_privileges": [
                "DELETE", "INSERT", "MAINTAIN", "REFERENCES", "SELECT", "TRIGGER",
                "TRUNCATE", "UPDATE",
            ],
            "public_privileges": [], "privilege_group_privileges": [],
            "materialized_row_required": False,
        },
        {
            "owner": "chenyida_erp_owner", "scope": "GLOBAL", "schema": None,
            "object_kind": "ROUTINE", "owner_privileges": ["EXECUTE"],
            "public_privileges": [], "privilege_group_privileges": [],
            "materialized_row_required": True,
        },
        {
            "owner": "chenyida_erp_owner", "scope": "GLOBAL", "schema": None,
            "object_kind": "TYPE", "owner_privileges": ["USAGE"],
            "public_privileges": [], "privilege_group_privileges": [],
            "materialized_row_required": True,
        },
    ]
    if not isinstance(roles, list) or len(roles) != 9 or not isinstance(memberships, list) \
            or len(memberships) != 4 or not isinstance(identities, dict) \
            or not isinstance(service_bindings, dict) or not isinstance(access_services, dict) \
            or policy.get("default_privileges") != expected_default_privileges:
        reject(code)
    role_names: list[str] = []
    role_checks: list[str] = []
    for role in roles:
        role = exact(role, {
            "name", "purpose", "intended_login", "inherit", "connection_limit",
            "superuser", "create_role", "create_database", "replication", "bypass_rls",
            "valid_until",
        }, code)
        name = role.get("name")
        if not isinstance(name, str) or DATABASE_IDENTIFIER.fullmatch(name) is None \
                or name in role_names or role.get("valid_until") is not None \
                or any(role.get(field) is not False for field in (
                    "superuser", "create_role", "create_database", "replication", "bypass_rls",
                )) or not isinstance(role.get("intended_login"), bool) \
                or not isinstance(role.get("inherit"), bool) \
                or isinstance(role.get("connection_limit"), bool) \
                or not isinstance(role.get("connection_limit"), int) \
                or not -1 <= role["connection_limit"] <= 1000:
            reject(code)
        role_names.append(name)
        role_checks.append(
            "  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname="
            f"{_pg_literal(name)} AND rolcanlogin={'true' if role['intended_login'] else 'false'}"
            f" AND rolinherit={'true' if role['inherit'] else 'false'}"
            f" AND rolconnlimit={role['connection_limit']} AND rolsuper=false"
            " AND rolcreatedb=false AND rolcreaterole=false AND rolreplication=false"
            " AND rolbypassrls=false AND rolvaliduntil IS NULL)"
            " THEN RAISE EXCEPTION 'rollback role boundary mismatch'; END IF;"
        )
    expected_role_names = {
        identities.get(field) for field in (
            "migration_owner", "admin_login", "admin_privilege_group", "backup_login",
            "backup_privilege_group", "web_login", "web_privilege_group", "worker_login",
            "worker_privilege_group",
        )
    }
    if set(role_names) != expected_role_names or None in expected_role_names:
        reject(code)
    role_literals = ",".join(_pg_literal(item) for item in sorted(role_names))
    membership_checks: list[str] = []
    membership_keys: set[tuple[str, str]] = set()
    for membership in memberships:
        membership = exact(membership, {
            "role", "member", "grantor", "admin_option", "inherit_option", "set_option",
        }, code)
        pair = (membership.get("role"), membership.get("member"))
        if pair in membership_keys or any(item not in role_names for item in pair) \
                or membership.get("grantor") != "PLATFORM_OWNER" \
                or membership.get("admin_option") is not False \
                or membership.get("inherit_option") is not True \
                or membership.get("set_option") is not False:
            reject(code)
        membership_keys.add(pair)
        membership_checks.append(
            "  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m"
            " JOIN pg_catalog.pg_roles r ON r.oid=m.roleid"
            " JOIN pg_catalog.pg_roles u ON u.oid=m.member"
            " JOIN pg_catalog.pg_roles g ON g.oid=m.grantor"
            f" WHERE r.rolname={_pg_literal(pair[0])} AND u.rolname={_pg_literal(pair[1])}"
            " AND g.rolname=current_user AND m.admin_option=false"
            " AND m.inherit_option=true AND m.set_option=false)"
            " THEN RAISE EXCEPTION 'rollback membership boundary mismatch'; END IF;"
        )
    staging_name = base["databases"]["staging_name"]
    staging = _pg_identifier(staging_name)
    owner = policy.get("database", {}).get("owner")
    schema = policy.get("schema", {}).get("name")
    schema_owner = policy.get("schema", {}).get("owner")
    if any(not isinstance(item, str) or DATABASE_IDENTIFIER.fullmatch(item) is None
           for item in (owner, schema, schema_owner)) \
            or owner != base["security"]["database_owner"] \
            or schema != base["security"]["schema_name"] \
            or schema_owner != base["security"]["schema_owner"]:
        reject(code)
    lock_literal = _pg_literal(
        f"chenyida-erp-uat-rollback:{base['runtime_plan_sha256']}",
    )
    statements = [
        "BEGIN;",
        "SET LOCAL search_path = pg_catalog;",
        "SELECT pg_catalog.pg_advisory_xact_lock("
        f"pg_catalog.hashtextextended({lock_literal},0));",
        "DO $cyd$", "BEGIN",
        f"  IF current_database() <> {_pg_literal(staging_name)}",
        "     OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> "
        f"{_pg_literal(base['postgres']['system_identifier'])}",
        "     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_database d"
        f" WHERE d.datname={_pg_literal(staging_name)} AND d.oid::text={_pg_literal(bindings['staging_oid'])}"
        f" AND pg_catalog.shobj_description(d.oid,'pg_database')={_pg_literal(base['databases']['staging_marker'])}"
        " AND d.datallowconn=true AND d.datconnlimit=0)",
        "     OR EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity"
        " WHERE datname=current_database() AND pid<>pg_backend_pid())",
        "     OR EXISTS (SELECT 1 FROM pg_catalog.pg_prepared_xacts"
        " WHERE database=current_database())",
        "  THEN RAISE EXCEPTION 'rollback reconciliation precondition mismatch'; END IF;",
        f"  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname=ANY(ARRAY[{role_literals}])) <> {len(role_names)}",
        "  THEN RAISE EXCEPTION 'rollback managed role set mismatch'; END IF;",
        "  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles"
        " WHERE rolname LIKE 'chenyida\\_erp\\_%' ESCAPE '\\'"
        f" AND NOT rolname=ANY(ARRAY[{role_literals}]))",
        "  THEN RAISE EXCEPTION 'rollback unexpected managed role'; END IF;",
        *role_checks,
        f"  IF (SELECT count(*) FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid JOIN pg_catalog.pg_roles u ON u.oid=m.member WHERE r.rolname=ANY(ARRAY[{role_literals}]) OR u.rolname=ANY(ARRAY[{role_literals}])) <> {len(memberships)}",
        "  THEN RAISE EXCEPTION 'rollback managed membership set mismatch'; END IF;",
        *membership_checks,
        "END", "$cyd$;",
        f"ALTER DATABASE {staging} OWNER TO {_pg_identifier(owner)};",
        f"ALTER SCHEMA {_pg_identifier(schema)} OWNER TO {_pg_identifier(schema_owner)};",
    ]
    tables = catalog.get("tables")
    sequences = catalog.get("sequences")
    routines = catalog.get("routines")
    standalone_types = catalog.get("standalone_types")
    if any(not isinstance(items, list) for items in (
        tables, sequences, routines, standalone_types,
    )):
        reject(code)
    table_names: set[str] = set()
    for item in tables:
        if not isinstance(item, dict) or item.get("owner") != "MIGRATION_OWNER" \
                or DATABASE_IDENTIFIER.fullmatch(item.get("name") or "") is None \
                or item["name"] in table_names:
            reject(code)
        table_names.add(item["name"])
        statements.append(
            f"ALTER TABLE {_pg_identifier(schema)}.{_pg_identifier(item['name'])}"
            f" OWNER TO {_pg_identifier(owner)};"
        )
    routine_identities: set[str] = set()
    for item in routines:
        if not isinstance(item, dict) or item.get("owner") not in {
            "MIGRATION_OWNER", "PLATFORM_OWNER",
        } or item.get("identity") in routine_identities:
            reject(code)
        routine = _pg_routine(item.get("identity"))
        routine_identities.add(item["identity"])
        if item["owner"] == "MIGRATION_OWNER":
            statements.append(
                f"ALTER ROUTINE {routine} OWNER TO {_pg_identifier(owner)};"
            )
    sequence_names = {item.get("name") for item in sequences if isinstance(item, dict)}
    type_identities = {item.get("identity") for item in standalone_types if isinstance(item, dict)}
    if len(sequence_names) != len(sequences) or any(
        not isinstance(item, str) or DATABASE_IDENTIFIER.fullmatch(item) is None
        for item in sequence_names
    ) or len(type_identities) != len(standalone_types) or any(
        not isinstance(item, str) for item in type_identities
    ):
        reject(code)
    endpoints = ["PUBLIC", *sorted(role_names), "pg_database_owner", "CURRENT_USER"]
    endpoint_sql = ", ".join(
        item if item in {"PUBLIC", "CURRENT_USER"} else _pg_identifier(item)
        for item in endpoints
    )
    statements.extend([
        f"REVOKE ALL PRIVILEGES ON DATABASE {staging} FROM {endpoint_sql};",
        f"REVOKE ALL PRIVILEGES ON SCHEMA {_pg_identifier(schema)} FROM {endpoint_sql};",
        f"REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA {_pg_identifier(schema)} FROM {endpoint_sql};",
        f"REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA {_pg_identifier(schema)} FROM {endpoint_sql};",
    ])
    for identity in sorted(routine_identities):
        statements.append(
            f"REVOKE ALL PRIVILEGES ON ROUTINE {_pg_routine(identity)} FROM {endpoint_sql};"
        )
    for identity in sorted(type_identities):
        statements.append(
            f"REVOKE ALL PRIVILEGES ON TYPE {_pg_qualified(identity)} FROM {endpoint_sql};"
        )
    statements.extend([
        f"GRANT ALL PRIVILEGES ON DATABASE {staging} TO {_pg_identifier(owner)};",
        f"GRANT ALL PRIVILEGES ON SCHEMA {_pg_identifier(schema)}"
        f" TO {_pg_identifier(schema_owner)};",
        f"GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA {_pg_identifier(schema)}"
        f" TO {_pg_identifier(owner)};",
        f"GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA {_pg_identifier(schema)}"
        f" TO {_pg_identifier(owner)};",
    ])
    for item in sorted(routines, key=lambda value: value["identity"]):
        owner_sql = _pg_identifier(owner) \
            if item["owner"] == "MIGRATION_OWNER" else "CURRENT_USER"
        statements.append(
            f"GRANT ALL PRIVILEGES ON ROUTINE {_pg_routine(item['identity'])}"
            f" TO {owner_sql};"
        )
    for identity in sorted(type_identities):
        statements.append(
            f"GRANT ALL PRIVILEGES ON TYPE {_pg_qualified(identity)} TO CURRENT_USER;"
        )
    allowed_table_privileges = {"SELECT", "INSERT", "UPDATE", "DELETE"}
    allowed_sequence_privileges = {"SELECT", "UPDATE", "USAGE"}
    for service in ("ADMIN", "BACKUP", "WEB", "WORKER"):
        service_access = access_services.get(service)
        binding = service_bindings.get(service)
        expected_group = identities.get(f"{service.lower()}_privilege_group")
        if not isinstance(service_access, dict) or not isinstance(binding, dict) \
                or binding.get("access_service") != service \
                or binding.get("direct_login_acl") is not False \
                or service_access.get("column_privileges") != {} \
                or binding.get("privilege_group") != expected_group \
                or DATABASE_IDENTIFIER.fullmatch(binding.get("privilege_group") or "") is None:
            reject(code)
        grantee = _pg_identifier(binding["privilege_group"])
        database_privileges = binding.get("database_privileges")
        schema_privileges = binding.get("schema_privileges")
        if database_privileges != ["CONNECT"] or schema_privileges != ["USAGE"]:
            reject(code)
        statements.extend([
            f"GRANT CONNECT ON DATABASE {staging} TO {grantee};",
            f"GRANT USAGE ON SCHEMA {_pg_identifier(schema)} TO {grantee};",
        ])
        table_privileges = service_access.get("table_privileges")
        sequence_privileges = service_access.get("sequence_privileges")
        routine_execute = service_access.get("routine_execute")
        if not isinstance(table_privileges, dict) \
                or set(table_privileges) != allowed_table_privileges \
                or not isinstance(sequence_privileges, dict) \
                or set(sequence_privileges) != allowed_sequence_privileges \
                or not isinstance(routine_execute, dict) \
                or set(routine_execute) != {"APPLICATION", "EXTENSION"}:
            reject(code)
        for privilege, objects in sorted(table_privileges.items()):
            if not isinstance(objects, list) or len(objects) != len(set(objects)) \
                    or any(item not in table_names for item in objects):
                reject(code)
            if objects:
                object_sql = ", ".join(
                    f"{_pg_identifier(schema)}.{_pg_identifier(item)}"
                    for item in sorted(objects)
                )
                statements.append(
                    f"GRANT {privilege} ON TABLE {object_sql} TO {grantee};"
                )
        for privilege, objects in sorted(sequence_privileges.items()):
            if not isinstance(objects, list) or len(objects) != len(set(objects)) \
                    or any(item not in sequence_names for item in objects):
                reject(code)
            if objects:
                object_sql = ", ".join(
                    f"{_pg_identifier(schema)}.{_pg_identifier(item)}"
                    for item in sorted(objects)
                )
                statements.append(
                    f"GRANT {privilege} ON SEQUENCE {object_sql} TO {grantee};"
                )
        execute_identities = [*routine_execute["APPLICATION"], *routine_execute["EXTENSION"]]
        if len(execute_identities) != len(set(execute_identities)) \
                or any(item not in routine_identities for item in execute_identities):
            reject(code)
        for identity in sorted(execute_identities):
            statements.append(
                f"GRANT EXECUTE ON ROUTINE {_pg_routine(identity)} TO {grantee};"
            )
    statements.extend([
        f"ALTER DEFAULT PRIVILEGES FOR ROLE {_pg_identifier(owner)}"
        " REVOKE EXECUTE ON ROUTINES FROM PUBLIC;",
        f"ALTER DEFAULT PRIVILEGES FOR ROLE {_pg_identifier(owner)}"
        " REVOKE USAGE ON TYPES FROM PUBLIC;",
        f"ALTER DATABASE {staging} SET default_transaction_read_only TO 'on';",
        f"COMMENT ON DATABASE {staging} IS {_pg_literal(base['databases']['staging_marker'])};",
        "COMMIT;", "",
    ])
    raw = "\n".join(statements).encode("utf-8")
    if len(raw) > base["runtime_limits"]["sql_max_bytes"]:
        reject(code)
    forbidden = (
        b"CREATE ROLE", b"ALTER ROLE", b"DROP ROLE", b"PASSWORD", b"VALID UNTIL",
        b"GRANT ALL PRIVILEGES ON TABLESPACE", b"REVOKE ALL PRIVILEGES ON TABLESPACE",
        b"ALTER TABLESPACE", b"CREATE TABLESPACE", b"DROP TABLESPACE",
    )
    if any(token in raw.upper() for token in forbidden):
        reject(code)
    return raw


def derive_pg_reconcile_opcode_spec(
        base: dict[str, Any], inputs: CapabilityInputs, bindings: dict[str, Any],
) -> dict[str, Any]:
    base = validate_pg_rollback_base_spec(base)
    raw = render_pg_reconciliation_sql(base, inputs, bindings)
    body = {
        "schema_version": 1,
        "contract": POSTGRES_RECONCILE_OPCODE_SPEC_CONTRACT,
        "opcode": "PG_RB_RECONCILE_PRIVILEGES_V1",
        "base_spec_sha256": base["base_spec_sha256"],
        "database": base["databases"]["staging_name"],
        "phase": "reconcile",
        "timeout_seconds": 300,
        "effectful": True,
        "bindings": bindings,
        "sql_sha256": hashlib.sha256(raw).hexdigest(),
        "argv_template_sha256": digest_value([
            "DOCKER_EXEC_POSTGRES_PSQL_V1", base["postgres"]["container_id"],
            base["databases"]["staging_name"], "reconcile",
            "SESSION_READ_WRITE_OVERRIDE_FIXED",
        ]),
    }
    return validate_pg_reconcile_opcode_spec(
        {**body, "opcode_spec_sha256": digest_value(body)}, base=base, inputs=inputs,
    )


def validate_pg_reconcile_opcode_spec(
        value: Any, *, base: dict[str, Any], inputs: CapabilityInputs,
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_RECONCILIATION_INVALID"
    base = validate_pg_rollback_base_spec(base)
    spec = exact(value, {
        "schema_version", "contract", "opcode", "base_spec_sha256", "database", "phase",
        "timeout_seconds", "effectful", "bindings", "sql_sha256",
        "argv_template_sha256", "opcode_spec_sha256",
    }, code)
    if spec.get("schema_version") != 1 \
            or spec.get("contract") != POSTGRES_RECONCILE_OPCODE_SPEC_CONTRACT \
            or spec.get("opcode") != "PG_RB_RECONCILE_PRIVILEGES_V1" \
            or spec.get("base_spec_sha256") != base["base_spec_sha256"] \
            or spec.get("database") != base["databases"]["staging_name"] \
            or spec.get("phase") != "reconcile" or spec.get("timeout_seconds") != 300 \
            or spec.get("effectful") is not True \
            or any(not SHA256.fullmatch(spec.get(field) or "") for field in (
                "sql_sha256", "argv_template_sha256", "opcode_spec_sha256",
            )) \
            or digest_value(without(spec, "opcode_spec_sha256")) \
                != spec["opcode_spec_sha256"]:
        reject(code)
    raw = render_pg_reconciliation_sql(base, inputs, spec.get("bindings"))
    if hashlib.sha256(raw).hexdigest() != spec["sql_sha256"] \
            or digest_value([
                "DOCKER_EXEC_POSTGRES_PSQL_V1", base["postgres"]["container_id"],
                base["databases"]["staging_name"], "reconcile",
                "SESSION_READ_WRITE_OVERRIDE_FIXED",
            ]) != spec["argv_template_sha256"]:
        reject(code)
    return spec


def _postgres_guarded_switch_material(
        base: dict[str, Any], inputs: CapabilityInputs, *, restored_oid: str,
) -> dict[str, Any]:
    """Load only trusted, plaintext-free sources used by the guarded switch."""
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_GUARDED_SWITCH_INVALID"
    base = validate_pg_rollback_base_spec(base)
    if OID.fullmatch(restored_oid or "") is None:
        reject(code)
    try:
        inputs.fd("snapshot_reconciliation")
        reconciliation = inputs.json("snapshot_reconciliation")
        report_text = reconciliation["database"]["report"]
        migration_raw = inputs.raw("snapshot_migrations")
    except (KeyError, TypeError, FixedExecutorError):
        reject(code)
    if not isinstance(report_text, str):
        reject(code)
    try:
        report_raw = report_text.encode("utf-8", "strict")
    except UnicodeError:
        reject(code)
    report = validate_database_reconciliation_report(report_raw)
    migration = validate_migration_ledger(
        migration_raw,
        expected_ledger_file_sha256=
            base["snapshot"]["migration_ledger_file_sha256"],
        expected_allowlist_sha256=
            base["snapshot"]["migration_allowlist_sha256"],
        expected_head=base["snapshot"]["migration_head"],
    )
    if report["sha256"] != base["snapshot"]["target_database_report_sha256"]:
        reject(code)
    security = derive_expected_runtime_privilege_state(
        inputs, base, {
            "database_oid": restored_oid,
            "mode": "SEALED_STAGING",
            "database_name": base["databases"]["staging_name"],
            "marker": base["databases"]["staging_marker"],
            "connection_limit": 0,
        },
    )
    return {
        "report_raw": report_raw,
        "report": report,
        "migration_raw": migration_raw,
        "migration": migration,
        "security": security,
        "security_state_sha256": digest_value(security),
    }


def _render_postgres_guarded_content_check(report_raw: bytes) -> str:
    """Recompute the accepted report in the trusted staging proof session."""
    validate_database_reconciliation_report(report_raw)
    rows = [line.split("\t") for line in report_raw[:-1].decode("utf-8").split("\n")]
    relations = [fields for fields in rows if fields[0] == "RELATION"]
    sequences = [fields for fields in rows if fields[0] == "SEQUENCE"]
    extensions = [fields[1:] for fields in rows if fields[0] == "EXTENSION"]
    large_objects = next(fields for fields in rows if fields[0] == "LARGE_OBJECTS")

    def values(items: list[list[str]], indexes: tuple[int, ...]) -> str:
        return ",\n      ".join(
            "(" + ",".join(_pg_literal(item[index]) for index in indexes) + ")"
            for item in items
        )

    relation_loop = ""
    if relations:
        relation_loop = f"""
  FOR expected IN
    SELECT * FROM (VALUES
      {values(relations, (1, 2, 3))}
    ) AS source(identity_hex,row_count,row_sha256)
  LOOP
    SELECT namespace.nspname,relation.relname
      INTO STRICT object_schema,object_name
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE relation.relkind IN ('r','p','m') AND NOT relation.relispartition
      AND namespace.nspname<>'information_schema' AND namespace.nspname!~'^pg_'
      AND pg_catalog.encode(pg_catalog.convert_to(
        namespace.nspname||'.'||relation.relname,'UTF8'),'hex')=expected.identity_hex;
    EXECUTE pg_catalog.format($query$
      WITH row_hashes AS (
        SELECT pg_catalog.encode(pg_catalog.sha256(
          pg_catalog.convert_to(pg_catalog.to_jsonb(source_row)::text,'UTF8')),
          'hex') AS value
        FROM %I.%I AS source_row
      ), aggregate_hash AS (
        SELECT count(*)::text AS row_count,
          coalesce(pg_catalog.sum((('x'||pg_catalog.substr(value,1,16))::bit(64)::bigint)::numeric),0)::text AS h1,
          coalesce(pg_catalog.sum((('x'||pg_catalog.substr(value,17,16))::bit(64)::bigint)::numeric),0)::text AS h2,
          coalesce(pg_catalog.sum((('x'||pg_catalog.substr(value,33,16))::bit(64)::bigint)::numeric),0)::text AS h3,
          coalesce(pg_catalog.sum((('x'||pg_catalog.substr(value,49,16))::bit(64)::bigint)::numeric),0)::text AS h4
        FROM row_hashes
      )
      SELECT row_count,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.concat_ws(':',row_count,h1,h2,h3,h4),'UTF8')),'hex')
      FROM aggregate_hash
    $query$,object_schema,object_name) INTO actual_count,actual_hash;
    IF actual_count<>expected.row_count OR actual_hash<>expected.row_sha256 THEN
      RAISE EXCEPTION 'guarded switch relation content mismatch';
    END IF;
  END LOOP;"""
    sequence_loop = ""
    if sequences:
        sequence_loop = f"""
  FOR expected IN
    SELECT * FROM (VALUES
      {values(sequences, (1, 2, 3))}
    ) AS source(identity_hex,last_value,is_called)
  LOOP
    SELECT namespace.nspname,relation.relname
      INTO STRICT object_schema,object_name
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE relation.relkind='S' AND namespace.nspname<>'information_schema'
      AND namespace.nspname!~'^pg_'
      AND pg_catalog.encode(pg_catalog.convert_to(
        namespace.nspname||'.'||relation.relname,'UTF8'),'hex')=expected.identity_hex;
    EXECUTE pg_catalog.format(
      'SELECT last_value::text,is_called::text FROM %I.%I',
      object_schema,object_name) INTO actual_count,actual_hash;
    IF actual_count<>expected.last_value
       OR actual_hash NOT IN (expected.is_called,
         CASE expected.is_called WHEN 'true' THEN 't' WHEN 'false' THEN 'f'
           WHEN 't' THEN 'true' ELSE 'false' END) THEN
      RAISE EXCEPTION 'guarded switch sequence content mismatch';
    END IF;
  END LOOP;"""
    extension_json = json.dumps(extensions, ensure_ascii=False, separators=(",", ":"))
    return f"""
SET TimeZone='UTC';
SET DateStyle='ISO, YMD';
SET IntervalStyle='iso_8601';
SET extra_float_digits=3;
SET bytea_output='hex';
SET default_transaction_read_only=on;
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='240s';
SET LOCAL idle_in_transaction_session_timeout='15s';
DO $cyd_guard_content$
DECLARE
  expected record;
  object_schema text;
  object_name text;
  actual_count text;
  actual_hash text;
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
      WHERE relation.relkind IN ('r','p','m') AND NOT relation.relispartition
        AND namespace.nspname<>'information_schema' AND namespace.nspname!~'^pg_')
      <> {len(relations)} THEN
    RAISE EXCEPTION 'guarded switch relation inventory mismatch';
  END IF;{relation_loop}
  IF (SELECT count(*) FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
      WHERE relation.relkind='S' AND namespace.nspname<>'information_schema'
        AND namespace.nspname!~'^pg_') <> {len(sequences)} THEN
    RAISE EXCEPTION 'guarded switch sequence inventory mismatch';
  END IF;{sequence_loop}
  IF coalesce((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        pg_catalog.encode(pg_catalog.convert_to(extension.extname,'UTF8'),'hex'),
        pg_catalog.encode(pg_catalog.convert_to(extension.extversion,'UTF8'),'hex'),
        pg_catalog.encode(pg_catalog.convert_to(namespace.nspname,'UTF8'),'hex'))
        ORDER BY extension.extname COLLATE "C")
      FROM pg_catalog.pg_extension extension
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid=extension.extnamespace
      WHERE extension.extname<>'plpgsql'), '[]'::jsonb)
      <> {_pg_guarded_literal(extension_json)}::jsonb THEN
    RAISE EXCEPTION 'guarded switch extension inventory mismatch';
  END IF;
  IF (SELECT count(*)::text FROM pg_catalog.pg_largeobject_metadata)
      <> {_pg_literal(large_objects[1])}
     OR {_pg_literal(large_objects[2])}<>'0'
     OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
       '0:0:0:0:0:0','UTF8')),'hex') <> {_pg_literal(large_objects[3])} THEN
    RAISE EXCEPTION 'guarded switch large object inventory mismatch';
  END IF;
END
$cyd_guard_content$;
COMMIT;
SET default_transaction_read_only=off;
"""


def render_pg_guarded_switch_sql(
        base: dict[str, Any], inputs: CapabilityInputs, bindings: dict[str, Any],
) -> bytes:
    """Render one closed psql session that re-proves, fences and switches."""
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_GUARDED_SWITCH_INVALID"
    base = validate_pg_rollback_base_spec(base)
    bindings = exact(bindings, {
        "privilege_receipt_sha256", "staging_oid", "before_observation_sha256",
        "staging_content_proof_sha256", "expected_switched_identity_sha256",
        "source_reconciliation_sha256", "expected_content_report_sha256",
        "migration_ledger_file_sha256", "migration_allowlist_sha256",
        "expected_security_state_sha256", "guarded_state_sha256",
    }, code)
    if OID.fullmatch(bindings.get("staging_oid") or "") is None \
            or any(SHA256.fullmatch(bindings.get(field) or "") is None
                   or bindings[field] == ZERO_SHA256
                   for field in bindings if field != "staging_oid"):
        reject(code)
    material = _postgres_guarded_switch_material(
        base, inputs, restored_oid=bindings["staging_oid"],
    )
    expected_bindings = {
        "source_reconciliation_sha256":
            base["snapshot"]["source_reconciliation_sha256"],
        "expected_content_report_sha256": material["report"]["sha256"],
        "migration_ledger_file_sha256":
            material["migration"]["ledger_file_sha256"],
        "migration_allowlist_sha256": material["migration"]["allowlist_sha256"],
        "expected_security_state_sha256": material["security_state_sha256"],
    }
    guarded_state_sha256 = digest_value({
        **expected_bindings,
        "staging_content_proof_sha256": bindings["staging_content_proof_sha256"],
        "staging_oid": bindings["staging_oid"],
    })
    expected_switched_identity_sha256 = digest_value({
        "active_name": base["databases"]["active_name"],
        "active_oid": bindings["staging_oid"],
        "quarantine_name": base["databases"]["quarantine_name"],
        "quarantine_oid": base["databases"]["candidate_oid"],
        "state": "NEW_SEALED",
    })
    if any(bindings[field] != expected for field, expected in expected_bindings.items()) \
            or bindings["guarded_state_sha256"] != guarded_state_sha256 \
            or bindings["expected_switched_identity_sha256"] \
                != expected_switched_identity_sha256:
        reject(code)
    migration_records = [
        {"checksum": line.split("  ", 1)[0], "version": line.split("  ", 1)[1]}
        for line in material["migration_raw"].decode("utf-8").splitlines()
    ]
    migration_json = json.dumps(
        migration_records, ensure_ascii=False, separators=(",", ":"),
    )
    expected_security_json = canonical(material["security"]).decode("utf-8").rstrip("\n")
    security_sql = embedded_postgres_sql(
        POSTGRES_SECURITY_SQL_ZLIB_BASE64, POSTGRES_SECURITY_SQL_SHA256,
    )
    suffix = b")::text;\n\nCOMMIT;\n"
    if security_sql.count(suffix) != 1:
        reject(code)
    security_capture = security_sql.replace(
        suffix,
        b")::text AS runtime_privilege_state\n"
        b"\\gset cyd_guard_\n\nCOMMIT;\n",
    ).decode("utf-8")
    names = base["databases"]
    postgres = base["postgres"]
    active = _pg_identifier(names["active_name"])
    staging = _pg_identifier(names["staging_name"])
    quarantine = _pg_identifier(names["quarantine_name"])
    active_name = _pg_literal(names["active_name"])
    staging_name = _pg_literal(names["staging_name"])
    quarantine_name = _pg_literal(names["quarantine_name"])
    candidate_oid = _pg_literal(names["candidate_oid"])
    staging_oid = _pg_literal(bindings["staging_oid"])
    candidate_marker = _pg_literal(names["candidate_marker"])
    staging_marker = _pg_literal(names["staging_marker"])
    quarantine_marker = _pg_literal(names["quarantine_marker"])
    system_identifier = _pg_literal(postgres["system_identifier"])
    lock_name = _pg_literal(f"chenyida-erp-uat-rollback:{base['runtime_plan_sha256']}")
    content_check = _render_postgres_guarded_content_check(material["report_raw"])
    sql = f"""SELECT pg_catalog.pg_advisory_lock(
  pg_catalog.hashtextextended({lock_name},0));
{content_check}
{security_capture}
SELECT (:'cyd_guard_runtime_privilege_state'::jsonb=
  {_pg_guarded_literal(expected_security_json)}::jsonb) AS cyd_guard_security_equal
\gset
\if :cyd_guard_security_equal
\else
DO $cyd_guard_security_failure$
BEGIN
  RAISE EXCEPTION 'guarded switch runtime privilege mismatch';
END
$cyd_guard_security_failure$;
\endif
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $cyd_guard_migration$
BEGIN
  IF coalesce((SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('checksum',checksum,'version',version)
      ORDER BY version COLLATE "C") FROM public.schema_migrations),'[]'::jsonb)
      <> {_pg_guarded_literal(migration_json)}::jsonb THEN
    RAISE EXCEPTION 'guarded switch migration ledger mismatch';
  END IF;
END
$cyd_guard_migration$;
COMMIT;
SET default_transaction_read_only=off;
\connect postgres
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL idle_in_transaction_session_timeout='15s';
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended({lock_name},0));
DO $cyd_guard_switch$
BEGIN
  IF (SELECT system_identifier::text FROM pg_catalog.pg_control_system())
       <> {system_identifier}
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_database d
       WHERE d.datname={staging_name} AND d.oid::text={staging_oid}
         AND pg_catalog.shobj_description(d.oid,'pg_database')={staging_marker}
         AND d.datallowconn=true AND d.datconnlimit=0
         AND EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s
           WHERE s.setdatabase=d.oid AND s.setrole=0
             AND 'default_transaction_read_only=on'=ANY(s.setconfig)))
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_database d
       WHERE d.datname={active_name} AND d.oid::text={candidate_oid}
         AND pg_catalog.shobj_description(d.oid,'pg_database')={candidate_marker}
         AND d.datallowconn=false AND d.datconnlimit=0)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname={quarantine_name})
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity
       WHERE datname IN ({active_name},{staging_name},{quarantine_name}))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_prepared_xacts
       WHERE database IN ({active_name},{staging_name},{quarantine_name}))
  THEN RAISE EXCEPTION 'guarded switch commit precondition mismatch'; END IF;
END
$cyd_guard_switch$;
ALTER DATABASE {staging} ALLOW_CONNECTIONS false;
ALTER DATABASE {active} RENAME TO {quarantine};
ALTER DATABASE {staging} RENAME TO {active};
COMMENT ON DATABASE {quarantine} IS {quarantine_marker};
COMMENT ON DATABASE {active} IS {candidate_marker};
COMMIT;
SELECT true;
""".encode("utf-8")
    if len(sql) > base["runtime_limits"]["sql_max_bytes"]:
        reject(code)
    return sql


def derive_pg_guarded_switch_opcode_spec(
        base: dict[str, Any], inputs: CapabilityInputs, bindings: dict[str, Any],
) -> dict[str, Any]:
    base = validate_pg_rollback_base_spec(base)
    raw = render_pg_guarded_switch_sql(base, inputs, bindings)
    body = {
        "schema_version": 1,
        "contract": POSTGRES_GUARDED_SWITCH_OPCODE_SPEC_CONTRACT,
        "opcode": "PG_RB_GUARDED_SWITCH_V3",
        "base_spec_sha256": base["base_spec_sha256"],
        "database": base["databases"]["staging_name"],
        "phase": "guardedswitch",
        "timeout_seconds": 300,
        "effectful": True,
        "bindings": bindings,
        "sql_sha256": hashlib.sha256(raw).hexdigest(),
        "argv_template_sha256": digest_value([
            "DOCKER_EXEC_POSTGRES_PSQL_V1", base["postgres"]["container_id"],
            base["databases"]["staging_name"], "guardedswitch",
            "SESSION_READ_WRITE_OVERRIDE_FIXED",
        ]),
    }
    return validate_pg_guarded_switch_opcode_spec(
        {**body, "opcode_spec_sha256": digest_value(body)}, base=base, inputs=inputs,
    )


def validate_pg_guarded_switch_opcode_spec(
        value: Any, *, base: dict[str, Any], inputs: CapabilityInputs,
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_GUARDED_SWITCH_INVALID"
    base = validate_pg_rollback_base_spec(base)
    spec = exact(value, {
        "schema_version", "contract", "opcode", "base_spec_sha256", "database",
        "phase", "timeout_seconds", "effectful", "bindings", "sql_sha256",
        "argv_template_sha256", "opcode_spec_sha256",
    }, code)
    if spec.get("schema_version") != 1 \
            or spec.get("contract") != POSTGRES_GUARDED_SWITCH_OPCODE_SPEC_CONTRACT \
            or spec.get("opcode") != "PG_RB_GUARDED_SWITCH_V3" \
            or spec.get("base_spec_sha256") != base["base_spec_sha256"] \
            or spec.get("database") != base["databases"]["staging_name"] \
            or spec.get("phase") != "guardedswitch" \
            or spec.get("timeout_seconds") != 300 or spec.get("effectful") is not True \
            or any(SHA256.fullmatch(spec.get(field) or "") is None
                   for field in ("sql_sha256", "argv_template_sha256", "opcode_spec_sha256")) \
            or digest_value(without(spec, "opcode_spec_sha256")) \
                != spec["opcode_spec_sha256"]:
        reject(code)
    raw = render_pg_guarded_switch_sql(base, inputs, spec.get("bindings"))
    if hashlib.sha256(raw).hexdigest() != spec["sql_sha256"] \
            or digest_value([
                "DOCKER_EXEC_POSTGRES_PSQL_V1", base["postgres"]["container_id"],
                base["databases"]["staging_name"], "guardedswitch",
                "SESSION_READ_WRITE_OVERRIDE_FIXED",
            ]) != spec["argv_template_sha256"]:
        reject(code)
    return spec


def parse_pg_state_observation(
        raw: bytes, *, base: dict[str, Any], observed_at: str,
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_OBSERVATION_INVALID"
    base = validate_pg_rollback_base_spec(base)
    value = parse_tool_json(raw, code)
    value = exact(value, {"system_identifier", "server_version_num", "databases"}, code)
    if value.get("system_identifier") != base["postgres"]["system_identifier"] \
            or value.get("server_version_num") != base["postgres"]["server_version_num"] \
            or not isinstance(value.get("databases"), list) \
            or len(value["databases"]) > 3 \
            or not isinstance(observed_at, str) or ISO_UTC.fullmatch(observed_at) is None:
        reject(code)
    allowed_names = {
        base["databases"]["active_name"], base["databases"]["staging_name"],
        base["databases"]["quarantine_name"],
    }
    normalized: list[dict[str, Any]] = []
    names: set[str] = set()
    for item in value["databases"]:
        item = exact(item, {
            "name", "oid", "marker", "allow_connections", "connection_limit",
            "default_transaction_read_only", "sessions", "prepared_xacts",
        }, code)
        if item.get("name") not in allowed_names or item["name"] in names \
                or not OID.fullmatch(item.get("oid") or "") \
                or not isinstance(item.get("marker"), str) or not item["marker"] \
                or not isinstance(item.get("allow_connections"), bool) \
                or isinstance(item.get("connection_limit"), bool) \
                or not isinstance(item.get("connection_limit"), int) \
                or not -1 <= item["connection_limit"] <= 1_000_000 \
                or not isinstance(item.get("default_transaction_read_only"), bool) \
                or any(isinstance(item.get(field), bool) or not isinstance(item.get(field), int)
                       or not 0 <= item[field] <= 1_000_000
                       for field in ("sessions", "prepared_xacts")):
            reject(code)
        names.add(item["name"])
        normalized.append(item)
    normalized.sort(key=lambda item: item["name"])
    body = {
        "schema_version": 1,
        "contract": "chenyida-erp-uat-rollback-postgresql-state-observation/v1",
        "runtime_plan_sha256": base["runtime_plan_sha256"],
        "base_spec_sha256": base["base_spec_sha256"],
        "system_identifier": value["system_identifier"],
        "server_version_num": value["server_version_num"],
        "databases": normalized,
        "observed_at": observed_at,
    }
    return {**body, "observation_sha256": digest_value(body)}


def postgres_empty_restore_projection() -> dict[str, Any]:
    return {
        "user_schema_count": 0,
        "relation_count": 0,
        "sequence_count": 0,
        "routine_count": 0,
        "standalone_type_count": 0,
        "unexpected_extension_count": 0,
        "large_object_count": 0,
        "schema_migrations_present": False,
    }


def validate_pg_restore_precondition_envelope(
        value: Any,
        code: str = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_RESTORE_PRECONDITION_INVALID",
) -> dict[str, Any]:
    """Validate the durable self-contained proof before context rebinding."""
    item = exact(value, {
        "schema_version", "contract", "base_spec_sha256", "opcode_spec_sha256",
        "binding_sha256", "create_receipt_sha256", "dump_inventory_sha256",
        "system_identifier", "server_version_num", "database",
        "database_identity_sha256", "profile", "profile_sha256",
        "empty_projection", "empty_projection_sha256", "raw_observation_sha256",
        "restore_precondition_sha256",
    }, code)
    database = exact(item["database"], {
        "name", "oid", "marker", "owner", "allow_connections", "connection_limit",
        "default_transaction_read_only", "sessions", "prepared_xacts",
    }, code)
    profile = exact(item["profile"], {
        "encoding", "locale_provider", "collate", "ctype", "collation_version",
        "default_tablespace",
    }, code)
    projection = exact(
        item["empty_projection"], set(postgres_empty_restore_projection()), code,
    )
    count_fields = (
        "user_schema_count", "relation_count", "sequence_count", "routine_count",
        "standalone_type_count", "unexpected_extension_count", "large_object_count",
    )
    if type(item["schema_version"]) is not int or item["schema_version"] != 1 \
            or item["contract"] != POSTGRES_RESTORE_PRECONDITION_CONTRACT \
            or item["binding_sha256"] != item["create_receipt_sha256"] \
            or not SYSTEM_IDENTIFIER.fullmatch(item.get("system_identifier") or "") \
            or not re.fullmatch(r"17[0-9]{4}", item.get("server_version_num") or "") \
            or not DATABASE_IDENTIFIER.fullmatch(database.get("name") or "") \
            or not OID.fullmatch(database.get("oid") or "") \
            or not RESTORED_STAGING_MARKER.fullmatch(database.get("marker") or "") \
            or database.get("owner") != "postgres" \
            or database.get("allow_connections") is not True \
            or type(database.get("connection_limit")) is not int \
            or database.get("connection_limit") != 0 \
            or database.get("default_transaction_read_only") is not True \
            or type(database.get("sessions")) is not int \
            or database.get("sessions") != 0 \
            or type(database.get("prepared_xacts")) is not int \
            or database.get("prepared_xacts") != 0 \
            or any(not isinstance(profile.get(field), str)
                   or not 1 <= len(profile[field]) <= 120
                   for field in ("encoding", "locale_provider", "collate", "ctype")) \
            or profile.get("collation_version") is not None \
                and (not isinstance(profile["collation_version"], str)
                     or not 1 <= len(profile["collation_version"]) <= 120) \
            or profile.get("locale_provider") != "libc" \
            or profile.get("default_tablespace") != "pg_default" \
            or any(type(projection.get(field)) is not int
                   for field in count_fields) \
            or projection.get("schema_migrations_present") is not False \
            or projection != postgres_empty_restore_projection() \
            or item["empty_projection_sha256"] != digest_value(projection) \
            or item["profile_sha256"] != digest_value(profile) \
            or item["database_identity_sha256"] != digest_value({
                "system_identifier": item["system_identifier"], **database,
            }) \
            or any(SHA256.fullmatch(item.get(field) or "") is None
                   or item[field] == ZERO_SHA256 for field in (
                       "base_spec_sha256", "opcode_spec_sha256", "binding_sha256",
                       "create_receipt_sha256", "dump_inventory_sha256",
                       "database_identity_sha256", "profile_sha256",
                       "empty_projection_sha256", "raw_observation_sha256",
                       "restore_precondition_sha256",
                   )) \
            or digest_value(without(item, "restore_precondition_sha256")) \
                != item["restore_precondition_sha256"]:
        reject(code)
    return item


def parse_pg_restore_precondition(
        raw: bytes, *, base: dict[str, Any], opcode_spec: dict[str, Any],
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_RESTORE_PRECONDITION_INVALID"
    base = validate_pg_rollback_base_spec(base)
    opcode_spec = validate_pg_opcode_spec(opcode_spec, base=base)
    if opcode_spec["opcode"] != "PG_RB_OBSERVE_STAGING_RESTORE_PRECONDITION_V1":
        reject(code)
    value = exact(parse_tool_json(raw, code), {
        "system_identifier", "server_version_num", "database", "profile", "projection",
    }, code)
    database = exact(value["database"], {
        "name", "oid", "marker", "owner", "allow_connections", "connection_limit",
        "default_transaction_read_only", "sessions", "prepared_xacts",
    }, code)
    observed_profile = exact(value["profile"], {
        "encoding", "locale_provider", "collate", "ctype", "collation_version",
        "tablespace",
    }, code)
    projection = exact(value["projection"], set(postgres_empty_restore_projection()), code)
    bindings = opcode_spec["bindings"]
    expected_observed_profile = {
        "encoding": base["profile"]["encoding"],
        "locale_provider": base["profile"]["locale_provider"],
        "collate": base["profile"]["collate"],
        "ctype": base["profile"]["ctype"],
        "collation_version": base["profile"]["collation_version"],
        "tablespace": base["profile"]["default_tablespace"],
    }
    profile = {
        **without(observed_profile, "tablespace"),
        "default_tablespace": observed_profile["tablespace"],
    }
    empty_projection = postgres_empty_restore_projection()
    empty_projection_sha256 = digest_value(empty_projection)
    if value["system_identifier"] != base["postgres"]["system_identifier"] \
            or value["server_version_num"] != base["postgres"]["server_version_num"] \
            or database != {
                "name": base["databases"]["staging_name"],
                "oid": bindings["staging_oid"],
                "marker": base["databases"]["staging_marker"],
                "owner": base["postgres"]["control_database_role"],
                "allow_connections": True,
                "connection_limit": 0,
                "default_transaction_read_only": True,
                "sessions": 0,
                "prepared_xacts": 0,
            } or observed_profile != expected_observed_profile \
            or profile != without(base["profile"], "profile_sha256") \
            or projection != empty_projection \
            or bindings["expected_empty_projection_sha256"] \
                != empty_projection_sha256:
        reject(code)
    body = {
        "schema_version": 1,
        "contract": POSTGRES_RESTORE_PRECONDITION_CONTRACT,
        "base_spec_sha256": base["base_spec_sha256"],
        "opcode_spec_sha256": opcode_spec["opcode_spec_sha256"],
        "binding_sha256": bindings["create_receipt_sha256"],
        "create_receipt_sha256": bindings["create_receipt_sha256"],
        "dump_inventory_sha256": bindings["dump_inventory_sha256"],
        "system_identifier": value["system_identifier"],
        "server_version_num": value["server_version_num"],
        "database": database,
        "database_identity_sha256": digest_value({
            "system_identifier": value["system_identifier"], **database,
        }),
        "profile": profile,
        "profile_sha256": digest_value(profile),
        "empty_projection": projection,
        "empty_projection_sha256": empty_projection_sha256,
        "raw_observation_sha256": hashlib.sha256(raw).hexdigest(),
    }
    return validate_pg_restore_precondition_proof(
        {**body, "restore_precondition_sha256": digest_value(body)},
        base=base, opcode_spec=opcode_spec,
    )


def validate_pg_restore_precondition_proof(
        value: Any, *, base: dict[str, Any], opcode_spec: dict[str, Any],
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_RESTORE_PRECONDITION_INVALID"
    base = validate_pg_rollback_base_spec(base)
    opcode_spec = validate_pg_opcode_spec(opcode_spec, base=base)
    item = validate_pg_restore_precondition_envelope(value, code)
    bindings = opcode_spec["bindings"]
    database = item["database"]
    profile = item["profile"]
    projection = item["empty_projection"]
    expected_profile = {
        "encoding": base["profile"]["encoding"],
        "locale_provider": base["profile"]["locale_provider"],
        "collate": base["profile"]["collate"],
        "ctype": base["profile"]["ctype"],
        "collation_version": base["profile"]["collation_version"],
        "default_tablespace": base["profile"]["default_tablespace"],
    }
    if item["base_spec_sha256"] != base["base_spec_sha256"] \
            or item["opcode_spec_sha256"] != opcode_spec["opcode_spec_sha256"] \
            or item["binding_sha256"] != bindings["create_receipt_sha256"] \
            or item["create_receipt_sha256"] != bindings["create_receipt_sha256"] \
            or item["dump_inventory_sha256"] != bindings["dump_inventory_sha256"] \
            or item["system_identifier"] != base["postgres"]["system_identifier"] \
            or item["server_version_num"] != base["postgres"]["server_version_num"] \
            or database["name"] != base["databases"]["staging_name"] \
            or database["oid"] != bindings["staging_oid"] \
            or database["marker"] != base["databases"]["staging_marker"] \
            or database["owner"] != base["postgres"]["control_database_role"] \
            or database["allow_connections"] is not True \
            or database["connection_limit"] != 0 \
            or database["default_transaction_read_only"] is not True \
            or database["sessions"] != 0 or database["prepared_xacts"] != 0 \
            or profile != expected_profile \
            or projection != postgres_empty_restore_projection() \
            or item["empty_projection_sha256"] != digest_value(projection) \
            or item["empty_projection_sha256"] \
                != bindings["expected_empty_projection_sha256"] \
            or item["profile_sha256"] != digest_value(profile) \
            or item["database_identity_sha256"] != digest_value({
                "system_identifier": item["system_identifier"], **database,
            }):
        reject(code)
    return item


def parse_postgres_capacity(raw: bytes, required_database_bytes: int) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_CAPACITY_INVALID"
    if not isinstance(raw, bytes) or not 2 <= len(raw) <= 64 * 1024 \
            or isinstance(required_database_bytes, bool) \
            or not isinstance(required_database_bytes, int) \
            or not 1 <= required_database_bytes <= 64 * 1024 * 1024 * 1024:
        reject(code)
    try:
        lines = [line.strip() for line in raw.decode("ascii").splitlines() if line.strip()]
    except UnicodeDecodeError:
        reject(code)
    if len(lines) != 2 or lines[0] != "Avail" \
            or re.fullmatch(r"(?:0|[1-9][0-9]{0,18})", lines[1]) is None:
        reject(code)
    available_bytes = int(lines[1])
    required_bytes = required_database_bytes + VOLUME_CAPACITY_RESERVE_BYTES
    if available_bytes > 2**53 - 1 or required_bytes > available_bytes:
        reject(code)
    body = {
        "schema_version": 1,
        "contract": "chenyida-erp-uat-rollback-postgresql-capacity/v1",
        "status": "SUFFICIENT_WITH_FIXED_RESERVE",
        "available_bytes": available_bytes,
        "snapshot_database_bytes": required_database_bytes,
        "reserve_bytes": VOLUME_CAPACITY_RESERVE_BYTES,
        "required_bytes": required_bytes,
    }
    return {**body, "capacity_sha256": digest_value(body)}


def parse_pg_dump_inventory(raw: bytes, *, dump_sha256: str) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_DUMP_INVENTORY_INVALID"
    if not isinstance(raw, bytes) or not 2 <= len(raw) <= MAX_JSON_BYTES \
            or not raw.endswith(b"\n") or not SHA256.fullmatch(dump_sha256 or ""):
        reject(code)
    try:
        lines = raw.decode("utf-8").splitlines()
    except UnicodeDecodeError:
        reject(code)
    entries: list[dict[str, Any]] = []
    seen: set[int] = set()
    forbidden = re.compile(
        r"(?:^| )(?:DATABASE|TABLESPACE|BLOB|BLOBS|LARGE OBJECT|PUBLICATION|"
        r"SUBSCRIPTION|FOREIGN DATA WRAPPER|USER MAPPING)(?: |$)",
    )
    for line in lines:
        if not line or line.startswith(";"):
            continue
        if any(ord(character) < 32 and character != "\t" for character in line):
            reject(code)
        matched = re.fullmatch(r"([1-9][0-9]{0,9}); ([0-9]+) ([0-9]+) (.{1,8192})", line)
        if matched is None:
            reject(code)
        dump_id = int(matched.group(1))
        description = matched.group(4)
        if dump_id in seen or forbidden.search(description.upper()) is not None:
            reject(code)
        seen.add(dump_id)
        entries.append({
            "dump_id": dump_id, "catalog_oid": matched.group(2),
            "object_oid": matched.group(3),
            "description_sha256": hashlib.sha256(description.encode("utf-8")).hexdigest(),
        })
    if not entries or len(entries) > 1_000_000:
        reject(code)
    body = {
        "schema_version": 1,
        "contract": "chenyida-erp-uat-rollback-postgresql-dump-inventory/v1",
        "dump_sha256": dump_sha256, "entry_count": len(entries),
        "entry_set_sha256": digest_value(entries),
        "raw_list_sha256": hashlib.sha256(raw).hexdigest(),
    }
    return {**body, "inventory_sha256": digest_value(body)}


def parse_pg_mutation_ack(raw: bytes, opcode: str) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_MUTATION_ACK_INVALID"
    allowed = {
        "PG_RB_CREATE_STAGING_V1", "PG_RB_RESTORE_DUMP_V1",
        "PG_RB_RECONCILE_PRIVILEGES_V1", "PG_RB_ATOMIC_SWITCH_V1",
        "PG_RB_GUARDED_SWITCH_V3",
        "PG_RB_UNSEAL_ACTIVE_V1", "PG_RB_SEAL_ACTIVE_V1",
    }
    if opcode not in allowed or not isinstance(raw, bytes) or len(raw) > 64 * 1024:
        reject(code)
    try:
        text = raw.decode("ascii")
    except UnicodeDecodeError:
        reject(code)
    if any(character not in " \t\r\nt" for character in text):
        reject(code)
    if opcode == "PG_RB_GUARDED_SWITCH_V3" \
            and [line.strip() for line in text.splitlines() if line.strip()] != ["t"]:
        reject(code)
    body = {
        "schema_version": 1,
        "contract": "chenyida-erp-uat-rollback-postgresql-mutation-ack/v1",
        "opcode": opcode, "stdout_bytes": len(raw),
        "stdout_sha256": hashlib.sha256(raw).hexdigest(),
    }
    return {**body, "ack_sha256": digest_value(body)}


def migration_allowlist_digest(records: list[dict[str, str]]) -> str:
    """Reproduce release-manifest-contract.mjs migrationAllowlistDigest exactly."""
    entries = [
        {"ordinal": index, "filename": item["version"], "sha256": item["checksum"]}
        for index, item in enumerate(records, start=1)
    ]
    try:
        raw = (json.dumps(
            entries, ensure_ascii=False, sort_keys=False, separators=(",", ":"),
            allow_nan=False,
        ) + "\n").encode("utf-8", "strict")
    except (KeyError, TypeError, ValueError, UnicodeError):
        reject("ROLLBACK_FIXED_EXECUTOR_MIGRATION_LEDGER_INVALID")
    return hashlib.sha256(raw).hexdigest()


def validate_migration_ledger(
        raw: bytes, *, expected_ledger_file_sha256: str,
        expected_allowlist_sha256: str, expected_head: str,
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_MIGRATION_LEDGER_INVALID"
    if not isinstance(raw, bytes) or not 2 <= len(raw) <= MAX_JSON_BYTES \
            or not raw.endswith(b"\n") or b"\r" in raw or b"\x00" in raw \
            or SHA256.fullmatch(expected_ledger_file_sha256 or "") is None \
            or SHA256.fullmatch(expected_allowlist_sha256 or "") is None \
            or expected_ledger_file_sha256 == ZERO_SHA256 \
            or expected_allowlist_sha256 == ZERO_SHA256 \
            or hashlib.sha256(raw).hexdigest() != expected_ledger_file_sha256 \
            or MIGRATION.fullmatch(expected_head or "") is None:
        reject(code)
    try:
        lines = raw.decode("utf-8").splitlines()
    except UnicodeDecodeError:
        reject(code)
    records: list[dict[str, str]] = []
    previous = ""
    for index, line in enumerate(lines, start=1):
        matched = re.fullmatch(r"([0-9a-f]{64})  ([0-9]{4}_[a-z0-9_]+\.sql)", line)
        if matched is None or matched.group(2) <= previous \
                or not matched.group(2).startswith(f"{index:04d}_"):
            reject(code)
        previous = matched.group(2)
        records.append({"checksum": matched.group(1), "version": matched.group(2)})
    if not records or records[-1]["version"] != expected_head:
        reject(code)
    allowlist_sha256 = migration_allowlist_digest(records)
    if allowlist_sha256 != expected_allowlist_sha256:
        reject(code)
    return {
        "head": expected_head,
        "ledger_file_sha256": expected_ledger_file_sha256,
        "allowlist_sha256": allowlist_sha256,
        "count": len(records), "ledger_sha256": digest_value(records),
    }


def validate_database_reconciliation_report(raw: bytes) -> dict[str, Any]:
    """Validate the exact plaintext-free report accepted by backup capture."""
    code = "ROLLBACK_FIXED_EXECUTOR_DATABASE_RECONCILIATION_INVALID"
    if not isinstance(raw, bytes) or not 2 <= len(raw) <= POSTGRES_CONTENT_REPORT_MAX_BYTES \
            or not raw.endswith(b"\n") or b"\r" in raw or b"\x00" in raw:
        reject(code)
    try:
        lines = raw[:-1].decode("utf-8").split("\n")
    except UnicodeDecodeError:
        reject(code)
    if not lines or len(lines) > 1_000_000:
        reject(code)
    seen: set[str] = set()
    large_objects = 0
    hex_identifier = re.compile(r"(?:[0-9a-f]{2}){1,4096}\Z")
    for line in lines:
        fields = line.split("\t")
        kind = fields[0] if fields else ""
        valid = False
        if kind == "RELATION" and len(fields) == 4:
            valid = hex_identifier.fullmatch(fields[1]) is not None \
                and re.fullmatch(r"[0-9]+", fields[2]) is not None \
                and SHA256.fullmatch(fields[3]) is not None
        elif kind == "SEQUENCE" and len(fields) == 4:
            valid = hex_identifier.fullmatch(fields[1]) is not None \
                and re.fullmatch(r"-?[0-9]+", fields[2]) is not None \
                and fields[3] in {"true", "false", "t", "f"}
        elif kind == "EXTENSION" and len(fields) == 4:
            valid = all(hex_identifier.fullmatch(field) is not None for field in fields[1:])
        elif kind == "LARGE_OBJECTS" and len(fields) == 4:
            large_objects += 1
            valid = re.fullmatch(r"[0-9]+", fields[1]) is not None \
                and re.fullmatch(r"[0-9]+", fields[2]) is not None \
                and SHA256.fullmatch(fields[3]) is not None \
                and large_objects == 1
        if not valid:
            reject(code)
        identity = f"{kind}:{fields[1]}"
        if identity in seen:
            reject("ROLLBACK_FIXED_EXECUTOR_DATABASE_RECONCILIATION_DUPLICATE")
        seen.add(identity)
    if large_objects != 1:
        reject(code)
    return {
        "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
        "rows": len(lines), "report_set_sha256": digest_value(sorted(seen)),
    }


def snapshot_database_reconciliation(
        inputs: CapabilityInputs, base: dict[str, Any],
) -> dict[str, str]:
    code = "ROLLBACK_FIXED_EXECUTOR_DATABASE_RECONCILIATION_SOURCE_INVALID"
    base = validate_pg_rollback_base_spec(base)
    try:
        package_reconciliation = inputs.package["content_reconciliation"]
        source = inputs.package["sources"]["snapshot_reconciliation"]
        report_sha256 = package_reconciliation["database"]["report_sha256"]
        source_sha256 = package_reconciliation["source_reconciliation_sha256"]
        inputs.fd("snapshot_reconciliation", maximum_bytes=256 * 1024 * 1024)
    except (KeyError, TypeError, FixedExecutorError):
        reject(code)
    if not SHA256.fullmatch(report_sha256 or "") \
            or report_sha256 != base["snapshot"]["target_database_report_sha256"] \
            or source_sha256 != base["snapshot"]["source_reconciliation_sha256"] \
            or source.get("sha256") != source_sha256:
        reject(code)
    return {"source_sha256": source_sha256, "report_sha256": report_sha256}


def validate_predecessor_migration_binding(
        inputs: CapabilityInputs, *, expected_head: str, expected_sha256: str,
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_MIGRATION_SOURCE_INVALID"
    try:
        predecessor = inputs.package["predecessor"]
        source = inputs.package["sources"]["predecessor_release_manifest"]
        manifest = inputs.json("predecessor_release_manifest")
        migrations = manifest["migrations"]
    except (KeyError, TypeError, FixedExecutorError):
        reject(code)
    if predecessor.get("migration_head") != expected_head \
            or predecessor.get("migration_manifest_sha256") != expected_sha256 \
            or migrations.get("head") != expected_head \
            or migrations.get("allowlist_sha256") != expected_sha256 \
            or source.get("sha256") != predecessor.get("release_manifest_sha256") \
            or not SHA256.fullmatch(source.get("sha256") or ""):
        reject(code)
    return manifest


RUNTIME_PRIVILEGE_ACL_PRIVILEGES = {
    "DATABASE": ("CONNECT", "CREATE", "TEMPORARY"),
    "SCHEMA": ("CREATE", "USAGE"),
    "TABLE": (
        "DELETE", "INSERT", "MAINTAIN", "REFERENCES", "SELECT", "TRIGGER",
        "TRUNCATE", "UPDATE",
    ),
    "SEQUENCE": ("SELECT", "UPDATE", "USAGE"),
    "ROUTINE": ("EXECUTE",), "TYPE": ("USAGE",),
    "TABLESPACE": ("CREATE",), "LARGE_OBJECT": ("SELECT", "UPDATE"),
}


def derive_expected_runtime_privilege_state(
        inputs: CapabilityInputs, base: dict[str, Any], target: dict[str, str],
) -> dict[str, Any]:
    """Port the v2 desired-state projection so a live observation must match policy exactly."""
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_SECURITY_STATE_INVALID"
    try:
        access = inputs.json("snapshot_runtime_privilege_access")
        catalog_document = inputs.json("snapshot_runtime_privilege_compiled_catalog")
        policy = inputs.json("snapshot_runtime_privilege_policy")
        catalog = catalog_document["catalog"]
        bindings = policy["service_bindings"]
        identities = policy["identities"]
        services = access["services"]
        if access["access_sha256"] != base["security"]["access_sha256"] \
                or catalog_document["catalog_sha256"] \
                    != base["security"]["catalog_sha256"] \
                or catalog_document["artifact_sha256"] \
                    != base["security"]["catalog_artifact_sha256"] \
                or policy["policy_sha256"] != base["security"]["policy_sha256"]:
            reject(code)
        target_mode = target.get("mode", "RELEASED_ACTIVE")
        if target_mode not in {"RELEASED_ACTIVE", "SEALED_STAGING"}:
            reject(code)
        target_database_name = target.get(
            "database_name", base["databases"]["active_name"],
        )
        target_marker = target.get(
            "marker", base["databases"]["candidate_marker"],
        )
        target_connection_limit = target.get(
            "connection_limit", 0 if target_mode == "SEALED_STAGING" else 64,
        )
        if target_database_name != (
                base["databases"]["staging_name"]
                if target_mode == "SEALED_STAGING"
                else base["databases"]["active_name"]
        ) or target_marker != (
                base["databases"]["staging_marker"]
                if target_mode == "SEALED_STAGING"
                else base["databases"]["candidate_marker"]
        ) or target_connection_limit != (0 if target_mode == "SEALED_STAGING" else 64):
            reject(code)
        expected_target = {
            "database_oid": target["database_oid"],
            "system_identifier_sha256": hashlib.sha256(
                base["postgres"]["system_identifier"].encode("utf-8"),
            ).hexdigest(),
            "marker_sha256": hashlib.sha256(
                target_marker.encode("utf-8"),
            ).hexdigest(),
        }
        roles = sorted(({
            "name": role["name"], "superuser": role["superuser"],
            "inherit": role["inherit"], "create_role": role["create_role"],
            "create_database": role["create_database"],
            "can_login": role["intended_login"], "replication": role["replication"],
            "connection_limit": role["connection_limit"],
            "valid_until": role["valid_until"], "bypass_rls": role["bypass_rls"],
        } for role in policy["roles"]), key=lambda item: item["name"].encode())
        memberships = [dict(item) for item in policy["memberships"]]

        owners: dict[tuple[str, str], str] = {
            ("DATABASE", target_database_name): policy["database"]["owner"],
            ("SCHEMA", policy["schema"]["name"]): policy["schema"]["owner"],
        }
        for kind, field in (
                ("TABLE", "tables"), ("SEQUENCE", "sequences"),
                ("ROUTINE", "routines"), ("TYPE", "standalone_types"),
        ):
            for item in catalog[field]:
                identity = f"public.{item['name']}" if kind in {"TABLE", "SEQUENCE"} \
                    else item["identity"]
                owner = identities["migration_owner"] \
                    if item["owner"] == "MIGRATION_OWNER" else item["owner"]
                if (kind, identity) in owners:
                    reject(code)
                owners[(kind, identity)] = owner
        for tablespace in policy["tablespaces"]["built_in"]:
            owners[("TABLESPACE", tablespace)] = "PLATFORM_OWNER"

        acl: list[dict[str, Any]] = []

        def add(kind: str, identity: str, owner: str, grantee: str, privilege: str) -> None:
            acl.append({
                "kind": kind, "identity": identity, "owner": owner, "grantor": owner,
                "grantee": grantee, "privilege_type": privilege,
                "is_grantable": False,
            })

        catalog_by_kind = {
            "TABLE": {item["name"]: item for item in catalog["tables"]},
            "SEQUENCE": {item["name"]: item for item in catalog["sequences"]},
            "ROUTINE": {item["identity"]: item for item in catalog["routines"]},
        }
        for service in ("ADMIN", "BACKUP", "WEB", "WORKER"):
            binding = bindings[service]
            group = binding["privilege_group"]
            if binding["access_service"] != service or binding["direct_login_acl"] is not False:
                reject(code)
            add("DATABASE", target_database_name, policy["database"]["owner"],
                group, "CONNECT")
            add("SCHEMA", policy["schema"]["name"], policy["schema"]["owner"],
                group, "USAGE")
            service_access = services[service]
            for privilege, names in service_access["table_privileges"].items():
                for name in names:
                    item = catalog_by_kind["TABLE"].get(name)
                    if item is None:
                        reject(code)
                    add("TABLE", f"public.{name}", owners[("TABLE", f"public.{name}")],
                        group, privilege)
            for privilege, names in service_access["sequence_privileges"].items():
                for name in names:
                    item = catalog_by_kind["SEQUENCE"].get(name)
                    if item is None:
                        reject(code)
                    add("SEQUENCE", f"public.{name}",
                        owners[("SEQUENCE", f"public.{name}")], group, privilege)
            routine_execute = service_access["routine_execute"]
            for identity in [*routine_execute["APPLICATION"], *routine_execute["EXTENSION"]]:
                if identity not in catalog_by_kind["ROUTINE"]:
                    reject(code)
                add("ROUTINE", identity, owners[("ROUTINE", identity)], group, "EXECUTE")
        acl.sort(key=lambda item: (
            item["kind"], item["identity"], item["grantee"],
            item["privilege_type"], item["grantor"],
        ))
        acl_keys = [(
            item["kind"], item["identity"], item["grantee"],
            item["privilege_type"], item["grantor"],
        ) for item in acl]
        if len(acl_keys) != len(set(acl_keys)):
            reject(code)
        counts = {
            kind.lower(): sum(item["kind"] == kind for item in acl)
            for kind in RUNTIME_PRIVILEGE_ACL_PRIVILEGES
        }
        counts["total"] = len(acl)
        if counts != policy["acl_summary"]["tuple_counts"]:
            reject(code)
        coverage = {
            kind.lower(): len({item["identity"] for item in acl if item["kind"] == kind})
            for kind in ("TABLE", "SEQUENCE", "ROUTINE")
        }
        if coverage != policy["acl_summary"]["object_coverage"]:
            reject(code)
        grantees: dict[tuple[str, str], set[str]] = {}
        for item in acl:
            grantees.setdefault((item["kind"], item["identity"]), set()).add(
                item["grantee"],
            )
        storage = []
        for (kind, identity), owner in owners.items():
            storage.append({
                "kind": kind, "identity": identity, "owner": owner,
                "acl_state": "EXPLICIT",
                "acl_item_count": 1 + len(grantees.get((kind, identity), set())),
                "owner_privileges": [
                    {"privilege_type": privilege, "is_grantable": False}
                    for privilege in RUNTIME_PRIVILEGE_ACL_PRIVILEGES[kind]
                ],
            })
        storage.sort(key=lambda item: (item["kind"], item["identity"]))
        default_scopes = sorted(({
            "owner": item["owner"],
            "schema": "ALL" if item["schema"] is None else item["schema"],
            "object_kind": item["object_kind"],
        } for item in policy["default_privileges"]
            if item["object_kind"] in {"ROUTINE", "TYPE"}),
            key=lambda item: (item["owner"], item["schema"], item["object_kind"]))
        state = {
            "schema_version": 2,
            "contract": "chenyida-erp-postgresql-runtime-privilege-state/v2",
            "target": expected_target,
            "engine": {
                "server_version_num": base["postgres"]["server_version_num"],
                "encoding": base["profile"]["encoding"],
                "locale_provider": base["profile"]["locale_provider"],
                "collate": base["profile"]["collate"],
                "ctype": base["profile"]["ctype"],
                "collation_version": base["profile"]["collation_version"],
            },
            "database": {
                "name": target_database_name,
                "owner": policy["database"]["owner"],
                "allow_connect": policy["database"]["allow_connect"],
                "connection_limit": target_connection_limit,
                "default_tablespace": policy["database"]["default_tablespace"],
            },
            "schema": {"name": policy["schema"]["name"],
                       "owner": policy["schema"]["owner"]},
            "roles": roles, "memberships": memberships,
            "role_settings": [] if target_mode == "RELEASED_ACTIVE" else [{
                "role_scope": "ALL", "database_scope": target_database_name,
                "settings": ["default_transaction_read_only=on"],
            }],
            "object_acl": acl, "object_acl_storage": storage,
            "column_acl": [], "column_acl_object_count": 0,
            "default_privilege_scopes": default_scopes,
            "default_privileges": [], "default_privilege_row_count": 2,
            "parameter_acl": [], "parameter_acl_row_count": 0,
            "custom_tablespaces": [], "custom_tablespace_count": 0,
            "large_object_count": 0,
        }
    except (KeyError, TypeError, ValueError):
        reject(code)
    return state


def parse_runtime_privilege_state(
        raw: bytes, *, inputs: CapabilityInputs, base: dict[str, Any],
        restored_oid: str | None = None, target: dict[str, Any] | None = None,
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_SECURITY_STATE_INVALID"
    if not isinstance(raw, bytes) or not 2 <= len(raw) <= MAX_JSON_BYTES \
            or not raw.endswith(b"\n") or b"\r" in raw or b"\x00" in raw:
        reject(code)
    actual = parse_tool_json(raw, code)
    if not isinstance(actual, dict):
        reject(code)
    if target is None:
        if restored_oid is None:
            reject(code)
        target = {"database_oid": restored_oid}
    elif restored_oid is not None:
        reject(code)
    expected = derive_expected_runtime_privilege_state(
        inputs, base, target,
    )
    if actual != expected:
        reject(code)
    return {"state": actual, "state_sha256": digest_value(actual)}


def parse_postgres_session_observation(
        raw: bytes, *, database: str, allowed_clients: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_SESSION_OBSERVATION_INVALID"
    if not isinstance(allowed_clients, dict) \
            or list(allowed_clients) != sorted(allowed_clients):
        reject(code)
    for role, client in allowed_clients.items():
        if DATABASE_IDENTIFIER.fullmatch(role or "") is None \
                or not isinstance(client, dict) \
                or set(client) != {"application_name", "pool_maximum"} \
                or not isinstance(client["application_name"], str) \
                or not 1 <= len(client["application_name"]) <= 64 \
                or any(ord(character) < 33 or ord(character) > 126
                       for character in client["application_name"]) \
                or not isinstance(client["pool_maximum"], int) \
                or isinstance(client["pool_maximum"], bool) \
                or not 1 <= client["pool_maximum"] <= 32:
            reject(code)
    maximum_sessions = sum(item["pool_maximum"] for item in allowed_clients.values())
    value = exact(parse_tool_json(raw, code), {
        "database", "sessions", "total",
    }, code)
    if value["database"] != database or not isinstance(value["sessions"], list) \
            or not isinstance(value["total"], int) or isinstance(value["total"], bool) \
            or not 0 <= value["total"] <= maximum_sessions:
        reject(code)
    total = 0
    role_totals = {role: 0 for role in allowed_clients}
    previous: tuple[str, str, str] | None = None
    for item in value["sessions"]:
        item = exact(item, {"role", "application_name", "state", "count"}, code)
        key = (item["role"], item["application_name"], item["state"])
        client = allowed_clients.get(item["role"])
        if not isinstance(client, dict) \
                or item["application_name"] != client["application_name"] \
                or item["state"] not in {"active", "idle", "idle in transaction"} \
                or not isinstance(item["count"], int) or isinstance(item["count"], bool) \
                or not 1 <= item["count"] <= client["pool_maximum"] \
                or previous is not None and key <= previous:
            reject(code)
        previous = key
        total += item["count"]
        role_totals[item["role"]] += item["count"]
    if total != value["total"] or any(
            role_totals[role] > client["pool_maximum"]
            for role, client in allowed_clients.items()
    ):
        reject(code)
    body = {
        "database": database, "allowed_clients": allowed_clients,
        "sessions": value["sessions"], "total": total,
    }
    return {
        **body, "allowed_role_set_sha256": digest_value(sorted(allowed_clients)),
        "client_policy_sha256": digest_value(allowed_clients),
        "observation_sha256": digest_value(body),
    }


def parse_postgres_database_identity(
        raw: bytes, *, expected_connection_limit: int = 64,
        expected_default_transaction_read_only: bool = False,
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_IDENTITY_OBSERVATION_INVALID"
    value = exact(parse_tool_json(raw, code), {
        "name", "system_identifier", "oid", "marker", "allow_connections",
        "connection_limit", "default_transaction_read_only", "prepared_xacts",
    }, code)
    if DATABASE_IDENTIFIER.fullmatch(value.get("name") or "") is None \
            or SYSTEM_IDENTIFIER.fullmatch(value.get("system_identifier") or "") is None \
            or OID.fullmatch(value.get("oid") or "") is None \
            or not isinstance(value.get("marker"), str) \
            or value.get("allow_connections") is not True \
            or value.get("connection_limit") != expected_connection_limit \
            or value.get("default_transaction_read_only") \
                is not expected_default_transaction_read_only \
            or value.get("prepared_xacts") != 0:
        reject(code)
    identity = {
        key: value[key] for key in ("name", "system_identifier", "oid", "marker")
    }
    return {**value, "identity_sha256": digest_value(identity)}


def validate_pg_pre_restore_layout(observation: dict[str, Any], *, base: dict[str, Any]) -> str:
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_OBSERVATION_INVALID"
    base = validate_pg_rollback_base_spec(base)
    if observation.get("contract") \
            != "chenyida-erp-uat-rollback-postgresql-state-observation/v1" \
            or observation.get("base_spec_sha256") != base["base_spec_sha256"] \
            or digest_value(without(observation, "observation_sha256")) \
                != observation.get("observation_sha256"):
        reject(code)
    rows = observation.get("databases")
    candidate = base["databases"]
    if not isinstance(rows, list) or len(rows) != 1:
        reject(code)
    row = rows[0]
    if row.get("name") != candidate["active_name"] \
            or row.get("oid") != candidate["candidate_oid"] \
            or row.get("marker") != candidate["candidate_marker"] \
            or row.get("allow_connections") is not False \
            or row.get("connection_limit") != 0 \
            or row.get("default_transaction_read_only") is not True \
            or row.get("sessions") != 0 or row.get("prepared_xacts") != 0:
        reject(code)
    return observation["observation_sha256"]


def classify_pg_rollback_layout(
        observation: dict[str, Any], *, base: dict[str, Any], restored_oid: str,
) -> dict[str, Any]:
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_OBSERVATION_INVALID"
    base = validate_pg_rollback_base_spec(base)
    if not OID.fullmatch(restored_oid or "") \
            or observation.get("contract") \
                != "chenyida-erp-uat-rollback-postgresql-state-observation/v1" \
            or observation.get("base_spec_sha256") != base["base_spec_sha256"] \
            or digest_value(without(observation, "observation_sha256")) \
                != observation.get("observation_sha256"):
        reject(code)
    by_name = {item["name"]: item for item in observation.get("databases", [])}
    if len(by_name) != len(observation.get("databases", [])):
        reject(code)
    names = base["databases"]

    def matches(
            name: str, oid: str, marker: str, allow: bool, limit: int, readonly: bool,
            *, allow_sessions: bool = False,
    ) -> bool:
        item = by_name.get(name)
        return isinstance(item, dict) and item.get("oid") == oid \
            and item.get("marker") == marker \
            and item.get("allow_connections") is allow \
            and item.get("connection_limit") == limit \
            and item.get("default_transaction_read_only") is readonly \
            and item.get("prepared_xacts") == 0 \
            and (allow_sessions or item.get("sessions") == 0)

    old = set(by_name) == {names["active_name"], names["staging_name"]} \
        and matches(
            names["active_name"], names["candidate_oid"], names["candidate_marker"],
            False, 0, True,
        ) and matches(
            names["staging_name"], restored_oid, names["staging_marker"], True, 0, True,
        )
    new_sealed = set(by_name) == {names["active_name"], names["quarantine_name"]} \
        and matches(
            names["active_name"], restored_oid, names["candidate_marker"], False, 0, True,
        ) and matches(
            names["quarantine_name"], names["candidate_oid"], names["quarantine_marker"],
            False, 0, True,
        )
    new_released = set(by_name) == {names["active_name"], names["quarantine_name"]} \
        and matches(
            names["active_name"], restored_oid, names["candidate_marker"], True, 64, False,
            allow_sessions=True,
        ) and matches(
            names["quarantine_name"], names["candidate_oid"], names["quarantine_marker"],
            False, 0, True,
        )
    layout = "OLD" if old else "NEW_SEALED" if new_sealed \
        else "NEW_RELEASED" if new_released else "INVALID"
    state_projection = {
        "base_spec_sha256": base["base_spec_sha256"],
        "runtime_plan_sha256": base["runtime_plan_sha256"],
        "system_identifier": observation.get("system_identifier"),
        "restored_oid": restored_oid,
        "databases": [{
            field: item[field] for field in (
                "name", "oid", "marker", "allow_connections", "connection_limit",
                "default_transaction_read_only", "prepared_xacts",
            )
        } for item in sorted(
            observation.get("databases", []), key=lambda value: value.get("name", ""),
        )],
    }
    if SYSTEM_IDENTIFIER.fullmatch(
            state_projection.get("system_identifier") or "",
    ) is None:
        reject(code)
    body = {
        "schema_version": 1,
        "contract": "chenyida-erp-uat-rollback-postgresql-layout-classification/v1",
        "runtime_plan_sha256": base["runtime_plan_sha256"],
        "base_spec_sha256": base["base_spec_sha256"],
        "observation_sha256": observation["observation_sha256"],
        "restored_oid": restored_oid,
        "layout": layout,
        "state_projection_sha256": digest_value(state_projection),
        "safe_to_recover_switch_receipt": layout == "NEW_SEALED",
        "safe_to_recover_unseal_receipt": layout == "NEW_RELEASED",
    }
    return {**body, "classification_sha256": digest_value(body)}


def postgres_layout_effect_identity(
        observation: dict[str, Any], classification: dict[str, Any], *,
        expected_layout: str, restored_oid: str,
) -> dict[str, Any]:
    """Return the stable database identity a mutation receipt can later re-prove.

    Observation timestamps, transient session counts and command acknowledgements are excluded;
    names, OIDs, markers, connection policy and prepared transactions remain bound.
    """
    code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_EFFECT_IDENTITY_INVALID"
    if expected_layout not in {"NEW_SEALED", "NEW_RELEASED"} \
            or classification.get("layout") != expected_layout \
            or classification.get("restored_oid") != restored_oid \
            or classification.get("observation_sha256") \
                != observation.get("observation_sha256"):
        reject(code)
    rows = observation.get("databases")
    if not isinstance(rows, list) or len(rows) != 2:
        reject(code)
    projected = []
    for row in sorted(rows, key=lambda item: item.get("name", "")):
        if not isinstance(row, dict):
            reject(code)
        try:
            projected.append({
                field: row[field] for field in (
                    "name", "oid", "marker", "allow_connections", "connection_limit",
                    "default_transaction_read_only", "prepared_xacts",
                )
            })
        except KeyError:
            reject(code)
    body = {
        "schema_version": 1,
        "contract": "chenyida-erp-uat-rollback-postgresql-effect-identity/v1",
        "base_spec_sha256": classification["base_spec_sha256"],
        "runtime_plan_sha256": classification["runtime_plan_sha256"],
        "system_identifier": observation.get("system_identifier"),
        "restored_oid": restored_oid,
        "layout": expected_layout,
        "databases": projected,
    }
    if SYSTEM_IDENTIFIER.fullmatch(body.get("system_identifier") or "") is None:
        reject(code)
    return {**body, "effect_identity_sha256": digest_value(body)}


def postgres_guarded_switch_intent_argv(opcode: dict[str, Any]) -> dict[str, Any]:
    """Project the exact effectful command identity stored in the durable intent."""
    try:
        projection = {
            "opcode": opcode["opcode"],
            "opcode_spec_sha256": opcode["opcode_spec_sha256"],
            "sql_sha256": opcode["sql_sha256"],
            "runner_argv_template_sha256": opcode["argv_template_sha256"],
        }
    except (KeyError, TypeError):
        reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_GUARDED_SWITCH_INVALID")
    if projection["opcode"] != "PG_RB_GUARDED_SWITCH_V3" \
            or any(SHA256.fullmatch(projection[field] or "") is None for field in (
                "opcode_spec_sha256", "sql_sha256", "runner_argv_template_sha256",
            )):
        reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_GUARDED_SWITCH_INVALID")
    return projection


def postgres_guarded_switch_intent_target(
        opcode: dict[str, Any], *, restored_oid: str, candidate_oid: str,
        staging_content_proof_sha256: str,
) -> dict[str, Any]:
    """Project the exact guarded state and database identities for the intent."""
    try:
        guarded_state_sha256 = opcode["bindings"]["guarded_state_sha256"]
        expected_switched_identity_sha256 = \
            opcode["bindings"]["expected_switched_identity_sha256"]
    except (KeyError, TypeError):
        reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_GUARDED_SWITCH_INVALID")
    if OID.fullmatch(restored_oid or "") is None \
            or OID.fullmatch(candidate_oid or "") is None \
            or any(SHA256.fullmatch(value or "") is None for value in (
                staging_content_proof_sha256, opcode.get("opcode_spec_sha256"),
                opcode.get("sql_sha256"), guarded_state_sha256,
                expected_switched_identity_sha256,
            )):
        reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_GUARDED_SWITCH_INVALID")
    return {
        "staging_oid": restored_oid,
        "candidate_oid": candidate_oid,
        "staging_content_proof_sha256": staging_content_proof_sha256,
        "guarded_opcode_spec_sha256": opcode["opcode_spec_sha256"],
        "guarded_sql_sha256": opcode["sql_sha256"],
        "guarded_state_sha256": guarded_state_sha256,
        "expected_switched_identity_sha256": expected_switched_identity_sha256,
    }


class UatRollbackCapabilityRuntime:
    """Closed dispatch for implemented repository-only capabilities.

    Unlisted database, Docker identity and health capabilities remain absent until their
    normalized observation and recovery boundaries are implemented and exercised.
    """

    INTERNAL_EXECUTION = {"PRECONDITION_RECHECK", "RUNTIME_CONFIGURATION_RESTORE"} \
        | WRITER_EXECUTION_HANDLERS | POSTGRES_EXECUTION_HANDLERS \
        | VOLUME_EXECUTION_HANDLERS | ACTIVATION_EXECUTION_HANDLERS \
        | PROTECTED_EXECUTION_HANDLERS
    INTERNAL_POSTVERIFY: set[str] = set(
        VOLUME_POSTVERIFY_HANDLERS | SERVICE_POSTVERIFY_HANDLERS
        | POSTGRES_POSTVERIFY_HANDLERS | HEALTH_POSTVERIFY_HANDLERS
        | METADATA_POSTVERIFY_HANDLERS,
    )

    def __init__(
            self, volume_driver: Any = None, postgres_driver: Any = None,
            writer_driver: Any = None, activation_driver: Any = None, *,
            protected_driver: Any = None, service_driver: Any = None,
            release_driver: Any = None, health_driver: Any = None,
            operation_driver: Any = None, filesystem_root: str = "/",
            clock: Any = utc_now,
    ):
        self.volume_driver = volume_driver
        self.postgres_driver = postgres_driver
        self.writer_driver = writer_driver
        self.activation_driver = activation_driver
        self.protected_driver = protected_driver
        self.service_driver = service_driver
        self.release_driver = release_driver
        self.health_driver = health_driver
        self.operation_driver = operation_driver
        self.filesystem_root = filesystem_root
        self.clock = clock

    @staticmethod
    def _unsupported(label: str) -> None:
        if label not in (*STAGES, *CHECKS):
            reject("ROLLBACK_FIXED_EXECUTOR_DISPATCH_INVALID")
        reject("ROLLBACK_FIXED_EXECUTOR_UAT_CAPABILITY_UNAVAILABLE")

    @staticmethod
    def _evidence(label: str, inputs: CapabilityInputs) -> dict[str, Any]:
        try:
            plan = inputs.plan
            package = inputs.package
            if label == "PRECONDITION_RECHECK":
                validate_reconciliation_policy_boundary(inputs)
                parameters = inputs.transaction_intent["parameters"]
                evidence = {
                    "execution_package_sha256": package["package_sha256"],
                    "source_set_sha256": package["source_set_sha256"],
                    "checkpoint_receipt_sha256":
                        parameters["previous_checkpoint_receipt_sha256"],
                    "snapshot_intent_sha256": parameters["snapshot_intent_sha256"],
                    "finalization_intent_sha256": parameters["finalization_intent_sha256"],
                    "runtime_plan_sha256": package["runtime_plan_sha256"],
                    "runtime_activation_sha256":
                        package["sources"]["runtime_adapter_activation"]["sha256"],
                }
            elif label == "RUNTIME_CONFIGURATION_RESTORE":
                configuration = derive_rollback_runtime_configuration(inputs)
                projection = derive_rollback_runtime_projection(plan)
                overlay = create_rollback_compose_overlay(plan)
                evidence = {
                    "compose_file_sha256": package["sources"]["compose_file"]["sha256"],
                    "compose_release_file_sha256":
                        package["sources"]["compose_release_file"]["sha256"],
                    "deployment_environment_sha256":
                        package["sources"]["deployment_environment"]["sha256"],
                    "runtime_policy_sha256": package["sources"]["runtime_policy"]["sha256"],
                    "predecessor_runtime_configuration_sha256":
                        package["predecessor"]["runtime_configuration_sha256"],
                    "rollback_runtime_projection_sha256":
                        projection["rollback_runtime_projection_sha256"],
                    "compose_rollback_overlay_sha256":
                        overlay["compose_rollback_overlay_sha256"],
                    "rollback_runtime_configuration_sha256":
                        configuration["rollback_runtime_configuration_sha256"],
                    "runtime_plan_sha256": package["runtime_plan_sha256"],
                }
            elif label == "PROTECTED_RESOURCE_RECHECK":
                evidence = {
                    "before_sha256": package["protected_resources_sha256"],
                    "after_sha256": package["protected_resources_sha256"],
                    "runtime_plan_sha256": package["runtime_plan_sha256"],
                    "observation_sha256": digest_value({
                        "deprecated_internal_projection": True,
                        "protected_resources_sha256": package["protected_resources_sha256"],
                        "runtime_plan_sha256": package["runtime_plan_sha256"],
                    }),
                }
            elif label == "RUNTIME_CONFIGURATION":
                rollback = inputs.rollback_result
                configuration = derive_rollback_runtime_configuration(inputs)
                predecessor_configuration_sha256 = \
                    package["predecessor"]["runtime_configuration_sha256"]
                configuration_stage = validate_handler_evidence(
                    "ROLLBACK_EXECUTION", "RUNTIME_CONFIGURATION_RESTORE",
                    rollback["stages"][6]["evidence"],
                )
                activation_stage = validate_handler_evidence(
                    "ROLLBACK_EXECUTION", "WEB_WORKER_PREDECESSOR_ACTIVATION",
                    rollback["stages"][7]["evidence"],
                )
                if rollback["predecessor_runtime_configuration_sha256"] \
                        != predecessor_configuration_sha256 \
                        or rollback["rollback_runtime_configuration_sha256"] \
                        != configuration["rollback_runtime_configuration_sha256"] \
                        or rollback["rollback_runtime_projection_sha256"] \
                            != configuration["rollback_runtime_projection_sha256"] \
                        or rollback["compose_rollback_overlay_sha256"] \
                            != configuration["compose_rollback_overlay_sha256"] \
                        or configuration_stage[
                            "predecessor_runtime_configuration_sha256"
                        ] != predecessor_configuration_sha256 \
                        or configuration_stage["rollback_runtime_projection_sha256"] \
                            != configuration["rollback_runtime_projection_sha256"] \
                        or configuration_stage["compose_rollback_overlay_sha256"] \
                            != configuration["compose_rollback_overlay_sha256"] \
                        or configuration_stage["rollback_runtime_configuration_sha256"] \
                            != configuration["rollback_runtime_configuration_sha256"] \
                        or configuration_stage["runtime_plan_sha256"] \
                            != package["runtime_plan_sha256"] \
                        or activation_stage["predecessor_runtime_configuration_sha256"] \
                            != predecessor_configuration_sha256 \
                        or activation_stage["rollback_runtime_configuration_sha256"] \
                            != configuration["rollback_runtime_configuration_sha256"] \
                        or activation_stage["rollback_runtime_projection_sha256"] \
                            != configuration["rollback_runtime_projection_sha256"] \
                        or activation_stage["compose_rollback_overlay_sha256"] \
                            != configuration["compose_rollback_overlay_sha256"] \
                        or activation_stage["protected_resources_sha256"] \
                            != package["protected_resources_sha256"] \
                        or activation_stage["runtime_plan_sha256"] \
                            != package["runtime_plan_sha256"]:
                    reject("ROLLBACK_FIXED_EXECUTOR_RUNTIME_CONFIGURATION_DRIFT")
                evidence = {
                    "predecessor_runtime_configuration_sha256":
                        rollback["predecessor_runtime_configuration_sha256"],
                    "rollback_runtime_configuration_sha256":
                        rollback["rollback_runtime_configuration_sha256"],
                    "rollback_runtime_projection_sha256":
                        rollback["rollback_runtime_projection_sha256"],
                    "compose_rollback_overlay_sha256":
                        rollback["compose_rollback_overlay_sha256"],
                    "deployment_environment_sha256":
                        package["sources"]["deployment_environment"]["sha256"],
                    "activation_stage_result_sha256":
                        rollback["stages"][7]["stage_result_sha256"],
                    "runtime_plan_sha256": package["runtime_plan_sha256"],
                }
            elif label == "STRICT_RELEASE_IDENTITY":
                rollback = inputs.rollback_result
                configuration = derive_rollback_runtime_configuration(inputs)
                activation = validate_handler_evidence(
                    "ROLLBACK_EXECUTION", "WEB_WORKER_PREDECESSOR_ACTIVATION",
                    rollback["stages"][7]["evidence"],
                )
                receipt = validate_postdeploy_receipt_document(
                    _validate_canonical_json_text(
                        activation["rollback_postdeploy_receipt_json"],
                        "ROLLBACK_FIXED_EXECUTOR_RELEASE_IDENTITY_DRIFT",
                    ),
                )
                identity = validate_release_identity_document(
                    _validate_canonical_json_text(
                        activation["release_identity_json"],
                        "ROLLBACK_FIXED_EXECUTOR_RELEASE_IDENTITY_DRIFT",
                    ),
                )
                receipt_sha256 = hashlib.sha256(
                    activation["rollback_postdeploy_receipt_json"].encode("utf-8"),
                ).hexdigest()
                identity_sha256 = hashlib.sha256(
                    activation["release_identity_json"].encode("utf-8"),
                ).hexdigest()
                try:
                    generated_at = datetime.strptime(
                        receipt["generated_at"], "%Y-%m-%dT%H:%M:%S.%fZ",
                    )
                    activation_started = datetime.strptime(
                        rollback["stages"][7]["started_at"],
                        "%Y-%m-%dT%H:%M:%S.%fZ",
                    )
                    activation_completed = datetime.strptime(
                        rollback["stages"][7]["completed_at"],
                        "%Y-%m-%dT%H:%M:%S.%fZ",
                    )
                except ValueError:
                    reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_IDENTITY_DRIFT")
                source_receipt = validate_postdeploy_receipt_document(
                    inputs.json("predecessor_postdeploy_receipt"),
                )
                source_manifest = inputs.json("predecessor_release_manifest")
                predecessor = package["predecessor"]
                expected_source = {
                    "application_version": predecessor["application_version"],
                    "git_commit": predecessor["git_commit"],
                    "git_tree": predecessor["git_tree"],
                }
                expected_migrations = {
                    "head": predecessor["migration_head"],
                    "manifest_sha256": predecessor["migration_manifest_sha256"],
                }
                expected_manifest_source = {
                    "package_version": predecessor["application_version"],
                    "git_commit": predecessor["git_commit"],
                    "git_tree": predecessor["git_tree"],
                }
                expected_manifest_migrations = {
                    "head": predecessor["migration_head"],
                    "allowlist_sha256": predecessor["migration_manifest_sha256"],
                }
                service = {item["service"]: item for item in receipt["services"]}
                expected_identity = {
                    "schema_version": 3,
                    "contract": "chenyida-erp-runtime-release-identity/v3",
                    "deployment_class": receipt["deployment"]["class"],
                    "deployment_id": receipt["deployment"]["id"],
                    "release_id": receipt["release"]["release_id"],
                    "release_manifest_sha256": receipt["release"]["manifest_sha256"],
                    "postdeploy_receipt_sha256": receipt_sha256,
                    "supervisor_bundle_sha256":
                        receipt["control"]["supervisor_bundle_sha256"],
                    "authorization_sha256": receipt["control"]["authorization_sha256"],
                    "runtime_guard": receipt["runtime_guard"],
                    "runtime_policy_sha256": receipt["runtime_policy_sha256"],
                    "application_version": receipt["source"]["application_version"],
                    "git_commit": receipt["source"]["git_commit"],
                    "git_tree": receipt["source"]["git_tree"],
                    "migration_head": receipt["migrations"]["head"],
                    "migration_manifest_sha256":
                        receipt["migrations"]["manifest_sha256"],
                    **{
                        f"{name}_container_id": service[name]["container_id"]
                        for name in ("caddy", "postgres", "web", "worker")
                    },
                    **{
                        f"{name}_image_digest": service[name]["image_id"]
                        for name in ("caddy", "postgres", "web", "worker")
                    },
                    "generated_at": receipt["generated_at"],
                }
                if receipt_sha256 != activation["rollback_postdeploy_receipt_sha256"] \
                        or identity_sha256 != activation["release_identity_sha256"] \
                        or identity != expected_identity \
                        or receipt["run_id"] \
                            != inputs.plan["targets"]["rollback_postdeploy_run_id"] \
                        or not activation_started <= generated_at <= activation_completed \
                        or receipt["release"] != source_receipt["release"] \
                        or receipt["source"] != expected_source \
                        or receipt["source"] != source_receipt["source"] \
                        or receipt["migrations"] != expected_migrations \
                        or receipt["migrations"] != source_receipt["migrations"] \
                        or receipt["control"] != {
                            "supervisor_bundle_sha256":
                                inputs.context["supervisor_bundle_sha256"],
                            "authorization_sha256": inputs.request["payload"][
                                "record_intent"
                            ]["execution_authorization_sha256"],
                        } \
                        or receipt["release"]["manifest_sha256"] \
                            != predecessor["release_manifest_sha256"] \
                        or receipt["runtime_configuration_sha256"] \
                            != configuration["rollback_runtime_configuration_sha256"] \
                        or rollback["predecessor_runtime_configuration_sha256"] \
                            != predecessor["runtime_configuration_sha256"] \
                        or rollback["rollback_runtime_configuration_sha256"] \
                            != configuration["rollback_runtime_configuration_sha256"] \
                        or activation["predecessor_runtime_configuration_sha256"] \
                            != predecessor["runtime_configuration_sha256"] \
                        or activation["rollback_runtime_configuration_sha256"] \
                            != configuration["rollback_runtime_configuration_sha256"] \
                        or activation["rollback_runtime_projection_sha256"] \
                            != configuration["rollback_runtime_projection_sha256"] \
                        or activation["compose_rollback_overlay_sha256"] \
                            != configuration["compose_rollback_overlay_sha256"] \
                        or activation["protected_resources_sha256"] \
                            != package["protected_resources_sha256"] \
                        or activation["runtime_plan_sha256"] \
                            != package["runtime_plan_sha256"]:
                    reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_IDENTITY_DRIFT")
                if source_receipt["release"]["manifest_sha256"] \
                        != predecessor["release_manifest_sha256"] \
                        or not isinstance(source_manifest, dict) \
                        or source_manifest.get("release_id") \
                            != source_receipt["release"]["release_id"] \
                        or source_manifest.get("source") != expected_manifest_source \
                        or source_manifest.get("migrations") \
                            != expected_manifest_migrations:
                    reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_IDENTITY_DRIFT")
                evidence = {
                    "release_identity_sha256": identity_sha256,
                    "release_manifest_sha256":
                        package["predecessor"]["release_manifest_sha256"],
                    "rollback_postdeploy_receipt_sha256": receipt_sha256,
                    "activation_stage_result_sha256":
                        rollback["stages"][7]["stage_result_sha256"],
                    "predecessor_runtime_configuration_sha256":
                        rollback["predecessor_runtime_configuration_sha256"],
                    "rollback_runtime_configuration_sha256":
                        rollback["rollback_runtime_configuration_sha256"],
                }
            elif label == "PROTECTED_RESOURCES":
                rollback = inputs.rollback_result
                protected_stage = validate_handler_evidence(
                    "ROLLBACK_EXECUTION", "PROTECTED_RESOURCE_RECHECK",
                    rollback["stages"][8]["evidence"],
                )
                if protected_stage["before_sha256"] != package["protected_resources_sha256"] \
                        or protected_stage["after_sha256"] \
                            != package["protected_resources_sha256"] \
                        or protected_stage["runtime_plan_sha256"] \
                            != package["runtime_plan_sha256"]:
                    reject("ROLLBACK_FIXED_EXECUTOR_PROTECTED_RESOURCE_INVALID")
                evidence = {
                    "before_sha256": package["protected_resources_sha256"],
                    "after_sha256": package["protected_resources_sha256"],
                    "protected_recheck_stage_result_sha256":
                        rollback["stages"][8]["stage_result_sha256"],
                    "runtime_plan_sha256": package["runtime_plan_sha256"],
                }
            else:
                UatRollbackCapabilityRuntime._unsupported(label)
        except (KeyError, TypeError, IndexError):
            reject("ROLLBACK_FIXED_EXECUTOR_CAPABILITY_INPUT_INVALID")
        operation = "ROLLBACK_EXECUTION" if label in STAGES else "ROLLBACK_POSTVERIFY"
        return validate_handler_evidence(operation, label, evidence)

    def _metadata_evidence(
            self, label: str, inputs: CapabilityInputs,
    ) -> dict[str, Any]:
        evidence = self._evidence(label, inputs)
        if label != "STRICT_RELEASE_IDENTITY":
            return evidence
        if self.release_driver is None:
            self._unsupported(label)
        try:
            activation = validate_handler_evidence(
                "ROLLBACK_EXECUTION", "WEB_WORKER_PREDECESSOR_ACTIVATION",
                inputs.rollback_result["stages"][7]["evidence"],
            )
            expected = {
                "receipt": validate_postdeploy_receipt_document(
                    _validate_canonical_json_text(
                        activation["rollback_postdeploy_receipt_json"],
                        "ROLLBACK_FIXED_EXECUTOR_RELEASE_IDENTITY_DRIFT",
                    ),
                ),
                "receipt_sha256": activation["rollback_postdeploy_receipt_sha256"],
                "receipt_json": activation["rollback_postdeploy_receipt_json"],
                "identity": validate_release_identity_document(
                    _validate_canonical_json_text(
                        activation["release_identity_json"],
                        "ROLLBACK_FIXED_EXECUTOR_RELEASE_IDENTITY_DRIFT",
                    ),
                ),
                "identity_sha256": activation["release_identity_sha256"],
                "identity_json": activation["release_identity_json"],
            }
            published = self.release_driver.read_published(inputs, expected=expected)
        except (KeyError, TypeError, IndexError, FixedExecutorError):
            reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_IDENTITY_DRIFT")
        if published["identity_sha256"] != evidence["release_identity_sha256"] \
                or published["receipt_sha256"] \
                    != evidence["rollback_postdeploy_receipt_sha256"]:
            reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_IDENTITY_DRIFT")
        return evidence

    def _writer_context(
            self, inputs: CapabilityInputs, *, run_preflight: bool,
    ) -> tuple[dict[str, Any], dict[str, Any] | None]:
        if self.writer_driver is None:
            self._unsupported("WRITER_CONTAINMENT")
        spec = derive_writer_containment_spec(inputs)
        preflight = self.writer_driver.preflight(spec) if run_preflight else None
        return spec, preflight

    @staticmethod
    def _writer_evidence(
            spec: dict[str, Any], database: dict[str, Any], services: dict[str, Any],
    ) -> dict[str, Any]:
        if database.get("state") != "SEALED" or services.get("status") != "exited":
            reject("ROLLBACK_FIXED_EXECUTOR_WRITER_RESULT_INVALID")
        by_name = {item["service"]: item for item in services.get("services", [])}
        if set(by_name) != {"web", "worker"} \
                or any(by_name[name]["container_id"] \
                       != spec["services"][name]["container_id"]
                       for name in by_name):
            reject("ROLLBACK_FIXED_EXECUTOR_WRITER_RESULT_INVALID")
        evidence = {
            "database_fence_sha256": database["observation_sha256"],
            "candidate_service_set_sha256": services["service_set_sha256"],
            "web_container_id": spec["services"]["web"]["container_id"],
            "worker_container_id": spec["services"]["worker"]["container_id"],
            "database_oid": spec["database"]["oid"],
            "system_identifier": spec["database"]["system_identifier"],
            "stopped": True, "sealed": True,
            "runtime_plan_sha256": spec["runtime_plan_sha256"],
        }
        return validate_handler_evidence("ROLLBACK_EXECUTION", "WRITER_CONTAINMENT", evidence)

    def _execute_writer(
            self, inputs: CapabilityInputs, effects: DurableSideEffectRecorder,
    ) -> dict[str, Any]:
        spec, preflight = self._writer_context(inputs, run_preflight=True)
        if preflight is None:
            reject("ROLLBACK_FIXED_EXECUTOR_WRITER_PREFLIGHT_INVALID")
        fenced, fence_receipt = self._complete_effect(
            inputs, effects, "DATABASE_FENCE",
            {"database": spec["database"], "writer_spec_sha256": spec["spec_sha256"]},
            {"opcode": "PG_RB_SEAL_ACTIVE_V1"},
            preflight["database"]["observation_sha256"],
            lambda: self.writer_driver.seal_database(
                spec, preflight["database"],
            ),
        )
        stopped, _stop_receipt = self._complete_effect(
            inputs, effects, "WRITER_STOP",
            {"services": spec["services"],
             "candidate_service_set_sha256": spec["candidate_service_set_sha256"]},
            {"opcode": "DOCKER_STOP_EXACT_CANDIDATE_WRITERS_V1", "timeout_seconds": 30},
            fence_receipt["receipt_sha256"],
            lambda: self.writer_driver.stop_candidate_writers(
                spec, preflight["services"],
            ),
        )
        return self._writer_evidence(
            spec, fenced["observation"], stopped["observation"],
        )

    def _recover_writer(
            self, inputs: CapabilityInputs, effects: DurableSideEffectRecorder,
    ) -> dict[str, Any]:
        fence_receipt = effects.receipt("DATABASE_FENCE")
        stop_receipt = effects.receipt("WRITER_STOP")
        if fence_receipt is None or stop_receipt is None:
            raise HandlerOutcomeUnknown(
                "PROBE_INCONCLUSIVE", "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            )
        if stop_receipt["before_identity_sha256"] != fence_receipt["receipt_sha256"]:
            raise HandlerOutcomeUnknown(
                "DURABLE_STATE_DIVERGED", "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            )
        spec, _preflight = self._writer_context(inputs, run_preflight=False)
        try:
            observed = self.writer_driver.probe(spec, stop_receipt["receipt_sha256"])
        except FixedExecutorError as error:
            raise HandlerOutcomeUnknown(
                "TARGET_IDENTITY_DRIFT", "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            ) from error
        return self._writer_evidence(spec, observed["database"], observed["services"])

    def _activation_context(
            self, inputs: CapabilityInputs, *, run_preflight: bool,
    ) -> dict[str, Any]:
        if self.activation_driver is None or self.release_driver is None:
            self._unsupported("WEB_WORKER_PREDECESSOR_ACTIVATION")
        base = derive_pg_rollback_base_spec(inputs)
        try:
            stages = inputs.rollback_result["stages"]
            if not isinstance(stages, list) or len(stages) < 7:
                raise KeyError("stages")
            pg_stage = stages[2]
            pg_evidence = validate_handler_evidence(
                "ROLLBACK_EXECUTION", "POSTGRESQL_RESTORE", pg_stage["evidence"],
            )
            volume_evidence = {
                label: validate_handler_evidence(
                    "ROLLBACK_EXECUTION", label, stages[index]["evidence"],
                )
                for index, label in enumerate((
                    "UPLOADS_RESTORE", "ATTACHMENTS_RESTORE", "BACKUP_STATUS_RESTORE",
                ), start=3)
            }
            configuration_stage = stages[6]
            configuration_evidence = validate_handler_evidence(
                "ROLLBACK_EXECUTION", "RUNTIME_CONFIGURATION_RESTORE",
                configuration_stage["evidence"],
            )
            stage_results = [stages[index]["stage_result_sha256"] for index in range(2, 7)]
            package = inputs.package
            plan = inputs.plan
        except (KeyError, TypeError, IndexError, FixedExecutorError):
            reject("ROLLBACK_FIXED_EXECUTOR_ACTIVATION_INPUT_INVALID")
        if any(not SHA256.fullmatch(item or "") for item in stage_results) \
                or pg_evidence["restored_database_oid"] == base["databases"]["candidate_oid"] \
                or pg_evidence["system_identifier"] != base["postgres"]["system_identifier"] \
                or pg_evidence["runtime_plan_sha256"] != base["runtime_plan_sha256"] \
                or pg_evidence["restored_database_marker"] \
                    != base["databases"]["candidate_marker"] \
                or pg_evidence["candidate_database_quarantine_name"] \
                    != base["databases"]["quarantine_name"] \
                or pg_evidence["candidate_database_quarantine_oid"] \
                    != base["databases"]["candidate_oid"] \
                or pg_evidence["uat_reconciliation_authority_sha256"] \
                    != base["authority"]["authority_sha256"] \
                or pg_evidence["uat_reconciliation_activation_sha256"] \
                    != package["sources"]["snapshot_policy_activation"]["sha256"] \
                or pg_evidence["sealed_security_projection_sha256"] \
                    != digest_value(base["security"]):
            reject("ROLLBACK_FIXED_EXECUTOR_ACTIVATION_INPUT_INVALID")
        for domain, label in (
                ("uploads", "UPLOADS_RESTORE"),
                ("attachments", "ATTACHMENTS_RESTORE"),
                ("backup_status", "BACKUP_STATUS_RESTORE"),
        ):
            evidence = volume_evidence[label]
            target = plan["targets"]["volumes"][domain]
            candidate = plan["candidate"]["volumes"][domain]
            if evidence["target_volume"] != target["target"] \
                    or evidence["retained_candidate_volume"] != candidate["name"] \
                    or evidence["retained_candidate_volume_identity_sha256"] \
                        != candidate["identity_sha256"] \
                    or evidence["runtime_plan_sha256"] != plan["runtime_plan_sha256"]:
                reject("ROLLBACK_FIXED_EXECUTOR_ACTIVATION_INPUT_INVALID")
        configuration = derive_rollback_runtime_configuration(inputs)
        projection = derive_rollback_runtime_projection(plan)
        overlay = create_rollback_compose_overlay(plan)
        if configuration_evidence["rollback_runtime_configuration_sha256"] \
                != configuration["rollback_runtime_configuration_sha256"] \
                or configuration_evidence["rollback_runtime_projection_sha256"] \
                    != projection["rollback_runtime_projection_sha256"] \
                or configuration_evidence["compose_rollback_overlay_sha256"] \
                    != overlay["compose_rollback_overlay_sha256"] \
                or configuration_evidence["predecessor_runtime_configuration_sha256"] \
                    != package["predecessor"]["runtime_configuration_sha256"]:
            reject("ROLLBACK_FIXED_EXECUTOR_ACTIVATION_INPUT_INVALID")
        predecessor_receipt = validate_postdeploy_receipt_document(
            inputs.json("predecessor_postdeploy_receipt"),
        )
        predecessor_manifest = inputs.json("predecessor_release_manifest")
        predecessor = package["predecessor"]
        if predecessor_receipt["release"]["manifest_sha256"] \
                != predecessor["release_manifest_sha256"] \
                or predecessor_receipt["source"] != {
                    "application_version": predecessor["application_version"],
                    "git_commit": predecessor["git_commit"],
                    "git_tree": predecessor["git_tree"],
                } or predecessor_receipt["migrations"] != {
                    "head": predecessor["migration_head"],
                    "manifest_sha256": predecessor["migration_manifest_sha256"],
                } or not isinstance(predecessor_manifest, dict) \
                or predecessor_manifest.get("release_id") \
                    != predecessor_receipt["release"]["release_id"]:
            reject("ROLLBACK_FIXED_EXECUTOR_ACTIVATION_INPUT_INVALID")
        prerequisites_sha256 = digest_value({
            "stage_result_sha256": stage_results,
            "rollback_runtime_configuration_sha256":
                configuration["rollback_runtime_configuration_sha256"],
            "postgresql_stage_evidence_sha256": digest_value(pg_evidence),
            "volume_stage_evidence_sha256": {
                label: digest_value(evidence) for label, evidence in volume_evidence.items()
            },
        })
        preflight = self.activation_driver.preflight(
            inputs, base, restored_oid=pg_evidence["restored_database_oid"],
            binding_sha256=prerequisites_sha256,
        ) if run_preflight else None
        publication_preflight = self.release_driver.preflight(inputs) \
            if run_preflight else None
        if not run_preflight:
            for role in ("deployment_environment", "compose_file", "compose_release_file"):
                inputs.fd(role, maximum_bytes=4 * 1024 * 1024)
        return {
            "base": base, "pg_evidence": pg_evidence,
            "volume_evidence": volume_evidence,
            "configuration": configuration, "configuration_evidence": configuration_evidence,
            "prerequisites_sha256": prerequisites_sha256, "preflight": preflight,
            "publication_preflight": publication_preflight,
        }

    def _protected_resource_evidence(self, inputs: CapabilityInputs) -> dict[str, Any]:
        if self.protected_driver is None:
            self._unsupported("PROTECTED_RESOURCE_RECHECK")
        try:
            plan = inputs.plan
            package = inputs.package
            deployment, _identity, candidate_services = _writer_candidate_documents(inputs)
            stages = inputs.rollback_result["stages"]
            volume_evidence = {
                domain: validate_handler_evidence(
                    "ROLLBACK_EXECUTION", label, stages[index]["evidence"],
                )
                for index, (domain, label) in enumerate((
                    ("uploads", "UPLOADS_RESTORE"),
                    ("attachments", "ATTACHMENTS_RESTORE"),
                    ("backup_status", "BACKUP_STATUS_RESTORE"),
                ), start=3)
            }
            activation = validate_handler_evidence(
                "ROLLBACK_EXECUTION", "WEB_WORKER_PREDECESSOR_ACTIVATION",
                stages[7]["evidence"],
            )
        except (KeyError, TypeError, IndexError, FixedExecutorError):
            reject("ROLLBACK_FIXED_EXECUTOR_PROTECTED_RESOURCE_INPUT_INVALID")
        protected = package.get("protected_resources_sha256")
        if not SHA256.fullmatch(protected or "") \
                or protected != deployment["protected_resources_after_sha256"] \
                or protected != plan["candidate"].get("protected_resources_sha256") \
                or activation["protected_resources_sha256"] != protected \
                or activation["runtime_plan_sha256"] != plan["runtime_plan_sha256"] \
                or any(
                    activation[name]["container_id"] \
                        != candidate_services[name]["container_id"]
                    or activation[name]["image_digest"] \
                        != candidate_services[name]["image_id"]
                    for name in ("caddy", "postgres")
                ):
            reject("ROLLBACK_FIXED_EXECUTOR_PROTECTED_RESOURCE_INPUT_INVALID")
        for domain, stage in volume_evidence.items():
            if stage["target_volume"] != plan["targets"]["volumes"][domain]["target"] \
                    or stage["retained_candidate_volume"] \
                        != plan["candidate"]["volumes"][domain]["name"] \
                    or stage["retained_candidate_volume_identity_sha256"] \
                        != plan["candidate"]["volumes"][domain]["identity_sha256"]:
                reject("ROLLBACK_FIXED_EXECUTOR_PROTECTED_RESOURCE_INPUT_INVALID")
        observation = self.protected_driver.observe(inputs, volume_evidence)
        if observation.get("protected_resources_sha256") != protected \
                or observation.get("runtime_plan_sha256") != plan["runtime_plan_sha256"] \
                or not SHA256.fullmatch(observation.get("observation_sha256") or ""):
            reject("ROLLBACK_FIXED_EXECUTOR_PROTECTED_RESOURCE_INVALID")
        return validate_handler_evidence(
            "ROLLBACK_EXECUTION", "PROTECTED_RESOURCE_RECHECK", {
                "before_sha256": protected, "after_sha256": protected,
                "runtime_plan_sha256": plan["runtime_plan_sha256"],
                "observation_sha256": observation["observation_sha256"],
            },
        )

    def _service_identity_evidence(
            self, label: str, inputs: CapabilityInputs, *,
            observation: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if label not in SERVICE_POSTVERIFY_HANDLERS \
                or observation is None and self.service_driver is None:
            self._unsupported(label)
        try:
            activation = validate_handler_evidence(
                "ROLLBACK_EXECUTION", "WEB_WORKER_PREDECESSOR_ACTIVATION",
                inputs.rollback_result["stages"][7]["evidence"],
            )
            plan = inputs.plan
            package = inputs.package
        except (KeyError, TypeError, IndexError, FixedExecutorError):
            reject("ROLLBACK_FIXED_EXECUTOR_SERVICE_IDENTITY_INPUT_INVALID")
        if observation is None:
            observation = self.service_driver.observe(inputs)
        by_name = {item["service"]: item for item in observation.get("services", [])}
        service = {
            "CADDY_IDENTITY": "caddy", "POSTGRES_IDENTITY": "postgres",
            "WEB_IDENTITY": "web", "WORKER_IDENTITY": "worker",
        }[label]
        current = by_name.get(service)
        expected = activation[service]
        expected_image_field = "image_digest" if service in {"caddy", "postgres"} \
            else "image_config_digest"
        if not isinstance(current, dict) \
                or current.get("container_id") != expected["container_id"] \
                or current.get("image_config_digest") != expected[expected_image_field] \
                or current.get("running") is not True or current.get("healthy") is not True \
                or current.get("restart_count") != 0 or current.get("oom_killed") is not False:
            reject("ROLLBACK_FIXED_EXECUTOR_SERVICE_IDENTITY_DRIFT")
        if service in {"caddy", "postgres"}:
            planned = plan["candidate"]["services"][service]
            inputs.json("candidate_deployment_result")
            if current["container_id"] != planned["container_id"] \
                    or current["image_config_digest"] != planned["image_digest"]:
                reject("ROLLBACK_FIXED_EXECUTOR_SERVICE_IDENTITY_DRIFT")
            evidence = {
                "container_id": current["container_id"],
                "image_digest": current["image_config_digest"],
                "running": True, "healthy": True, "restart_count": 0,
                "oom_killed": False,
            }
        else:
            predecessor_receipt = validate_postdeploy_receipt_document(
                inputs.json("predecessor_postdeploy_receipt"),
            )
            predecessor_manifest = inputs.json("predecessor_release_manifest")
            predecessor = package["predecessor"]
            if current["image_reference"] != plan["predecessor"][f"{service}_image"] \
                    or current["image_config_digest"] \
                        != plan["predecessor"][f"{service}_image_config_digest"] \
                    or predecessor_receipt["release"]["manifest_sha256"] \
                        != predecessor["release_manifest_sha256"] \
                    or not isinstance(predecessor_manifest, dict) \
                    or predecessor_manifest.get("release_id") \
                        != predecessor_receipt["release"]["release_id"]:
                reject("ROLLBACK_FIXED_EXECUTOR_SERVICE_IDENTITY_DRIFT")
            evidence = {
                "container_id": current["container_id"],
                "image_reference": current["image_reference"],
                "image_config_digest": current["image_config_digest"],
                "application_version": predecessor["application_version"],
                "git_commit": predecessor["git_commit"],
                "running": True, "healthy": True, "restart_count": 0,
                "oom_killed": False,
            }
        return validate_handler_evidence("ROLLBACK_POSTVERIFY", label, evidence)

    def _health_evidence(
            self, inputs: CapabilityInputs,
    ) -> dict[str, Any]:
        code = "ROLLBACK_FIXED_EXECUTOR_HEALTH_EVIDENCE_INVALID"
        if self.health_driver is None or self.release_driver is None:
            self._unsupported("HEALTH")
        runtime_configuration = self._metadata_evidence(
            "RUNTIME_CONFIGURATION", inputs,
        )
        strict_identity = self._metadata_evidence(
            "STRICT_RELEASE_IDENTITY", inputs,
        )
        try:
            activation = validate_handler_evidence(
                "ROLLBACK_EXECUTION", "WEB_WORKER_PREDECESSOR_ACTIVATION",
                inputs.rollback_result["stages"][7]["evidence"],
            )
            receipt = validate_postdeploy_receipt_document(
                _validate_canonical_json_text(
                    activation["rollback_postdeploy_receipt_json"], code,
                ),
            )
            expected_identity = validate_release_identity_document(
                _validate_canonical_json_text(
                    activation["release_identity_json"], code,
                ),
            )
            observed = exact(self.health_driver.observe(inputs), {
                "services", "readiness", "mounted_release_identity",
            }, code)
        except (KeyError, TypeError, IndexError, FixedExecutorError):
            reject(code)
        readiness = validate_postdeploy_readiness_document(
            observed["readiness"], code,
        )
        mounted_raw = observed["mounted_release_identity"]
        if not isinstance(mounted_raw, bytes) or not 2 <= len(mounted_raw) <= 64 * 1024:
            reject(code)
        mounted_identity = validate_release_identity_document(
            strict_json(mounted_raw, code),
        )
        if mounted_raw != canonical(mounted_identity) \
                or mounted_identity != expected_identity \
                or hashlib.sha256(mounted_raw).hexdigest() \
                    != strict_identity["release_identity_sha256"]:
            reject("ROLLBACK_FIXED_EXECUTOR_HEALTH_RELEASE_IDENTITY_DRIFT")
        published_readiness = receipt["readiness"]
        try:
            current_database_time = datetime.strptime(
                readiness["database_time"], "%Y-%m-%dT%H:%M:%S.%fZ",
            )
            published_database_time = datetime.strptime(
                published_readiness["database_time"], "%Y-%m-%dT%H:%M:%S.%fZ",
            )
        except ValueError:
            reject(code)
        if without(readiness, "database_time") \
                != without(published_readiness, "database_time") \
                or current_database_time < published_database_time:
            reject("ROLLBACK_FIXED_EXECUTOR_HEALTH_READINESS_DRIFT")
        service_observation = observed["services"]
        services = {}
        for name in ("caddy", "postgres", "web", "worker"):
            identity_evidence = self._service_identity_evidence(
                f"{name.upper()}_IDENTITY", inputs,
                observation=service_observation,
            )
            services[name] = identity_evidence if name in {"caddy", "postgres"} \
                else without(without(identity_evidence, "application_version"), "git_commit")
        checked_at = self.clock()
        try:
            checked_time = datetime.strptime(
                checked_at, "%Y-%m-%dT%H:%M:%S.%fZ",
            )
        except (TypeError, ValueError):
            reject(code)
        if abs((checked_time - current_database_time).total_seconds()) \
                > HEALTH_DATABASE_TIME_MAX_SKEW_SECONDS:
            reject("ROLLBACK_FIXED_EXECUTOR_HEALTH_FRESHNESS_INVALID")
        body = {
            "status": "HEALTHY", "checked_at": checked_at,
            "readiness_sha256": digest_value(readiness), "readiness": readiness,
            "services": services, "service_set_sha256": digest_value(services),
            "release_identity_sha256": strict_identity["release_identity_sha256"],
            "runtime_configuration_sha256": runtime_configuration[
                "rollback_runtime_configuration_sha256"
            ],
            "backup_status_disposition": BACKUP_STATUS_DISPOSITION,
            "current_backup_readiness": False,
            "post_rollback_backup_required": True,
        }
        return validate_handler_evidence(
            "ROLLBACK_POSTVERIFY", "HEALTH",
            {**body, "health_sha256": digest_value(body)},
        )

    @staticmethod
    def _activation_evidence(
            inputs: CapabilityInputs, context: dict[str, Any],
            database: dict[str, Any], services: dict[str, Any], documents: dict[str, Any],
            unseal_receipt: dict[str, Any], activation_receipt: dict[str, Any],
            preactivation_content_proof: dict[str, Any],
    ) -> dict[str, Any]:
        base = context["base"]
        pg_evidence = context["pg_evidence"]
        by_database = {item["name"]: item for item in database["databases"]}
        active = by_database.get(base["databases"]["active_name"])
        quarantine = by_database.get(base["databases"]["quarantine_name"])
        by_service = {item["service"]: item for item in services["services"]}
        if not isinstance(active, dict) or not isinstance(quarantine, dict) \
                or set(by_service) != {"caddy", "postgres", "web", "worker"}:
            reject("ROLLBACK_FIXED_EXECUTOR_ACTIVATION_RESULT_INVALID")
        application_service = lambda name: {
            "container_id": by_service[name]["container_id"],
            "image_reference": by_service[name]["image_reference"],
            "image_config_digest": by_service[name]["image_config_digest"],
            "running": by_service[name]["running"],
            "healthy": by_service[name]["healthy"],
            "restart_count": by_service[name]["restart_count"],
            "oom_killed": by_service[name]["oom_killed"],
        }
        protected_service = lambda name: {
            "container_id": by_service[name]["container_id"],
            "image_digest": by_service[name]["image_config_digest"],
            "running": by_service[name]["running"],
            "healthy": by_service[name]["healthy"],
            "restart_count": by_service[name]["restart_count"],
            "oom_killed": by_service[name]["oom_killed"],
        }
        package = inputs.package
        configuration = context["configuration"]
        proof = validate_preactivation_content_proof(preactivation_content_proof)
        expected_proof = {
            "binding_sha256": unseal_receipt["receipt_sha256"],
            "runtime_plan_sha256": base["runtime_plan_sha256"],
            "source_reconciliation_sha256":
                base["snapshot"]["source_reconciliation_sha256"],
            "source_database_report_sha256":
                base["snapshot"]["target_database_report_sha256"],
            "live_database_report_sha256":
                base["snapshot"]["target_database_report_sha256"],
            "migration_head": base["snapshot"]["migration_head"],
            "migration_ledger_file_sha256":
                base["snapshot"]["migration_ledger_file_sha256"],
            "migration_allowlist_sha256":
                base["snapshot"]["migration_allowlist_sha256"],
            "restored_database_oid": pg_evidence["restored_database_oid"],
            "restored_database_marker": base["databases"]["candidate_marker"],
            "system_identifier": base["postgres"]["system_identifier"],
            "candidate_database_quarantine_name":
                base["databases"]["quarantine_name"],
            "candidate_database_quarantine_oid": base["databases"]["candidate_oid"],
            "candidate_database_quarantine_marker":
                base["databases"]["quarantine_marker"],
        }
        if any(proof[field] != value for field, value in expected_proof.items()) \
                or proof["active_database_identity_sha256"] \
                    != digest_value({
                        "name": base["databases"]["active_name"],
                        "system_identifier": proof["system_identifier"],
                        "oid": proof["restored_database_oid"],
                        "marker": proof["restored_database_marker"],
                    }):
            reject("ROLLBACK_FIXED_EXECUTOR_PREACTIVATION_PROOF_INVALID")
        evidence = {
            "strategy": "RECREATE_WEB_WORKER_FROM_PREDECESSOR_PINNED_DIGESTS",
            "web": application_service("web"), "worker": application_service("worker"),
            "caddy": protected_service("caddy"),
            "postgres": protected_service("postgres"),
            "rollback_postdeploy_receipt_sha256": documents["receipt_sha256"],
            "rollback_postdeploy_receipt_json": documents["receipt_json"],
            "release_identity_sha256": documents["identity_sha256"],
            "release_identity_json": documents["identity_json"],
            "predecessor_runtime_configuration_sha256":
                package["predecessor"]["runtime_configuration_sha256"],
            "rollback_runtime_configuration_sha256":
                configuration["rollback_runtime_configuration_sha256"],
            "rollback_runtime_projection_sha256":
                configuration["rollback_runtime_projection_sha256"],
            "compose_rollback_overlay_sha256":
                configuration["compose_rollback_overlay_sha256"],
            "protected_resources_sha256": package["protected_resources_sha256"],
            "runtime_plan_sha256": base["runtime_plan_sha256"],
            "uat_reconciliation_authority_sha256":
                pg_evidence["uat_reconciliation_authority_sha256"],
            "uat_reconciliation_activation_sha256":
                pg_evidence["uat_reconciliation_activation_sha256"],
            "sealed_security_projection_sha256":
                pg_evidence["sealed_security_projection_sha256"],
            "database_unseal_receipt_sha256": unseal_receipt["receipt_sha256"],
            "compose_invocation_receipt_sha256":
                activation_receipt["after_identity_sha256"],
            "active_database_allow_connections": active["allow_connections"],
            "active_database_connection_limit": active["connection_limit"],
            "candidate_database_quarantine_allow_connections":
                quarantine["allow_connections"],
            "candidate_database_quarantine_connection_limit":
                quarantine["connection_limit"],
            "preactivation_content_proof": proof,
        }
        return validate_handler_evidence(
            "ROLLBACK_EXECUTION", "WEB_WORKER_PREDECESSOR_ACTIVATION", evidence,
        )

    def _execute_activation(
            self, inputs: CapabilityInputs, effects: DurableSideEffectRecorder,
    ) -> dict[str, Any]:
        context = self._activation_context(inputs, run_preflight=True)
        preflight = context["preflight"]
        if not isinstance(preflight, dict):
            reject("ROLLBACK_FIXED_EXECUTOR_ACTIVATION_PREFLIGHT_INVALID")
        unsealed, unseal_receipt = self._complete_effect(
            inputs, effects, "DATABASE_UNSEAL",
            {"restored_database_oid": context["pg_evidence"]["restored_database_oid"],
             "prerequisites_sha256": context["prerequisites_sha256"]},
            {"opcode": "PG_RB_UNSEAL_ACTIVE_V1"},
            context["pg_evidence"]["switch_receipt_sha256"],
            lambda: self.activation_driver.unseal(
                context["base"], context["pg_evidence"],
                activation_prerequisites_sha256=context["prerequisites_sha256"],
                before_observation=preflight["database"],
            ),
            receipt_identity=lambda outcome: postgres_layout_effect_identity(
                outcome["observation"], outcome["classification"],
                expected_layout="NEW_RELEASED",
                restored_oid=context["pg_evidence"]["restored_database_oid"],
            ),
        )
        proof = self.activation_driver.prove_content(
            inputs, context["base"],
            restored_oid=context["pg_evidence"]["restored_database_oid"],
            binding_sha256=unseal_receipt["receipt_sha256"],
        )
        proof = effects.record_read_only_proof(PREACTIVATION_CONTENT_PROOF_NAME, proof)
        activated, activation_receipt = self._complete_effect(
            inputs, effects, "WEB_WORKER_ACTIVATE",
            {"runtime_plan_sha256": context["base"]["runtime_plan_sha256"],
             "predecessor_images": preflight["images"]},
            {"opcode": "COMPOSE_PINNED_PREDECESSOR_WRITERS_V1"},
            unseal_receipt["receipt_sha256"],
            lambda: self.activation_driver.activate(inputs),
        )
        generated_at = self.clock()
        documents = build_rollback_release_documents(
            inputs, activated["services"],
            runtime_configuration_sha256=
                context["configuration"]["rollback_runtime_configuration_sha256"],
            generated_at=generated_at, readiness=activated["readiness"],
        )
        published, _publication_receipt = self._complete_effect(
            inputs, effects, "RELEASE_EVIDENCE_PUBLISH",
            {"service_set_sha256": activated["services"]["service_set_sha256"],
             "runtime_configuration_sha256":
                context["configuration"]["rollback_runtime_configuration_sha256"],
             "previous_identity_sha256":
                context["publication_preflight"]["current_identity_sha256"]},
            {"opcode": "PUBLISH_DURABLE_ROLLBACK_RELEASE_EVIDENCE_V1"},
            activation_receipt["receipt_sha256"],
            lambda: self.release_driver.publish(inputs, documents),
        )
        return self._activation_evidence(
            inputs, context, unsealed["observation"], activated["services"], published,
            unseal_receipt, activation_receipt, proof,
        )

    def _recover_activation(
            self, inputs: CapabilityInputs, effects: DurableSideEffectRecorder,
    ) -> dict[str, Any]:
        context = self._activation_context(inputs, run_preflight=False)
        receipts = {
            name: effects.receipt(name)
            for name in SIDE_EFFECTS_BY_LABEL["WEB_WORKER_PREDECESSOR_ACTIVATION"]
        }
        unseal_receipt = receipts["DATABASE_UNSEAL"]
        activation_receipt = receipts["WEB_WORKER_ACTIVATE"]
        publication_receipt = receipts["RELEASE_EVIDENCE_PUBLISH"]
        unseal_intent = effects.started_intent("DATABASE_UNSEAL")
        activation_intent = effects.started_intent("WEB_WORKER_ACTIVATE")
        expected_unseal_target = {
            "restored_database_oid": context["pg_evidence"]["restored_database_oid"],
            "prerequisites_sha256": context["prerequisites_sha256"],
        }
        if unseal_intent is None \
                or unseal_intent["target_identity_sha256"] \
                    != digest_value(expected_unseal_target) \
                or unseal_intent["argv_template_sha256"] \
                    != digest_value({"opcode": "PG_RB_UNSEAL_ACTIVE_V1"}):
            raise HandlerOutcomeUnknown(
                "PROBE_INCONCLUSIVE", "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            )
        if unseal_receipt is None:
            if activation_intent is not None:
                raise HandlerOutcomeUnknown(
                    "PROBE_INCONCLUSIVE", "PROBE", side_effects_started=True,
                    uncertain_action="EXECUTE",
                )
            try:
                database_probe = self.activation_driver.probe_database(
                    context["base"],
                    restored_oid=context["pg_evidence"]["restored_database_oid"],
                    binding_sha256=unseal_intent["intent_sha256"],
                )
                effect_identity = postgres_layout_effect_identity(
                    database_probe["observation"], database_probe["classification"],
                    expected_layout="NEW_RELEASED",
                    restored_oid=context["pg_evidence"]["restored_database_oid"],
                )
                unseal_receipt = create_recovered_side_effect_receipt(
                    unseal_intent,
                    context["pg_evidence"]["switch_receipt_sha256"],
                    digest_value(effect_identity),
                    database_probe["observation"]["observation_sha256"], self.clock(),
                )
                effects.complete("DATABASE_UNSEAL", unseal_receipt)
            except FixedExecutorError as error:
                raise HandlerOutcomeUnknown(
                    "TARGET_IDENTITY_DRIFT", "PROBE", side_effects_started=True,
                    uncertain_action="EXECUTE",
                ) from error
        proof = effects.read_only_proof(PREACTIVATION_CONTENT_PROOF_NAME)
        assert unseal_receipt is not None
        if unseal_receipt["before_identity_sha256"] \
                != context["pg_evidence"]["switch_receipt_sha256"]:
            raise HandlerOutcomeUnknown(
                "DURABLE_STATE_DIVERGED", "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            )
        if proof is None and activation_intent is None:
            try:
                proof = self.activation_driver.prove_content(
                    inputs, context["base"],
                    restored_oid=context["pg_evidence"]["restored_database_oid"],
                    binding_sha256=unseal_receipt["receipt_sha256"],
                )
                proof = effects.record_read_only_proof(
                    PREACTIVATION_CONTENT_PROOF_NAME, proof,
                )
            except FixedExecutorError as error:
                raise HandlerOutcomeUnknown(
                    "TARGET_IDENTITY_DRIFT", "PROBE", side_effects_started=True,
                    uncertain_action="EXECUTE",
                ) from error
        if activation_receipt is None:
            raise HandlerOutcomeUnknown(
                "PROBE_INCONCLUSIVE", "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            )
        if proof is None or proof["binding_sha256"] != unseal_receipt["receipt_sha256"]:
            raise HandlerOutcomeUnknown(
                "DURABLE_STATE_MISSING", "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            )
        if activation_receipt["before_identity_sha256"] != unseal_receipt["receipt_sha256"] \
                or publication_receipt is not None \
                    and publication_receipt["before_identity_sha256"] \
                        != activation_receipt["receipt_sha256"]:
            raise HandlerOutcomeUnknown(
                "DURABLE_STATE_DIVERGED", "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            )
        try:
            observed = self.activation_driver.probe(
                inputs, context["base"],
                restored_oid=context["pg_evidence"]["restored_database_oid"],
                binding_sha256=activation_receipt["receipt_sha256"]
                    if publication_receipt is None
                    else publication_receipt["receipt_sha256"],
            )
            unseal_identity = postgres_layout_effect_identity(
                observed["database"], observed["classification"],
                expected_layout="NEW_RELEASED",
                restored_oid=context["pg_evidence"]["restored_database_oid"],
            )
            if unseal_receipt["after_identity_sha256"] \
                    != digest_value(unseal_identity):
                reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_EFFECT_IDENTITY_INVALID")
            published = self.release_driver.recover_published(inputs)
            current_readiness = validate_postdeploy_readiness_document(
                observed["readiness"],
            )
            published_readiness = published["receipt"]["readiness"]
            if without(current_readiness, "database_time") \
                    != without(published_readiness, "database_time") \
                    or datetime.strptime(
                        current_readiness["database_time"], "%Y-%m-%dT%H:%M:%S.%fZ",
                    ) < datetime.strptime(
                        published_readiness["database_time"], "%Y-%m-%dT%H:%M:%S.%fZ",
                    ):
                reject("ROLLBACK_FIXED_EXECUTOR_READINESS_DRIFT")
            documents = build_rollback_release_documents(
                inputs, observed["services"],
                runtime_configuration_sha256=
                    context["configuration"]["rollback_runtime_configuration_sha256"],
                generated_at=published["receipt"]["generated_at"],
                readiness=published["receipt"]["readiness"],
            )
            if documents != published:
                reject("ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_BINDING_INVALID")
        except FixedExecutorError as error:
            raise HandlerOutcomeUnknown(
                "TARGET_IDENTITY_DRIFT", "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            ) from error
        if publication_receipt is None:
            intent = effects.started_intent("RELEASE_EVIDENCE_PUBLISH")
            if intent is None:
                raise HandlerOutcomeUnknown(
                    "PROBE_INCONCLUSIVE", "PROBE", side_effects_started=True,
                    uncertain_action="EXECUTE",
                )
            observation_sha256 = digest_value({
                "receipt_sha256": published["receipt_sha256"],
                "identity_sha256": published["identity_sha256"],
            })
            publication_receipt = create_recovered_side_effect_receipt(
                intent, activation_receipt["receipt_sha256"], digest_value(documents),
                observation_sha256, self.clock(),
            )
            effects.complete("RELEASE_EVIDENCE_PUBLISH", publication_receipt)
        if digest_value(documents) != publication_receipt["after_identity_sha256"]:
            raise HandlerOutcomeUnknown(
                "DURABLE_STATE_DIVERGED", "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            )
        return self._activation_evidence(
            inputs, context, observed["database"], observed["services"], documents,
            unseal_receipt, activation_receipt, proof,
        )

    def _postgres_base_context(
            self, inputs: CapabilityInputs, *, run_preflight: bool,
    ) -> tuple[dict[str, Any], dict[str, Any], str, dict[str, Any] | None]:
        if self.postgres_driver is None:
            self._unsupported("POSTGRESQL_RESTORE")
        base = derive_pg_rollback_base_spec(inputs)
        try:
            stage = inputs.rollback_result["stages"][1]
            writer_evidence = validate_handler_evidence(
                "ROLLBACK_EXECUTION", "WRITER_CONTAINMENT", stage["evidence"],
            )
            writer_stage_result_sha256 = stage["stage_result_sha256"]
        except (KeyError, TypeError, IndexError, FixedExecutorError):
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_INPUT_INVALID")
        if not SHA256.fullmatch(writer_stage_result_sha256 or "") \
                or writer_evidence["database_oid"] != base["databases"]["candidate_oid"] \
                or writer_evidence["system_identifier"] \
                    != base["postgres"]["system_identifier"] \
                or writer_evidence["runtime_plan_sha256"] != base["runtime_plan_sha256"] \
                or writer_evidence["stopped"] is not True \
                or writer_evidence["sealed"] is not True:
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_INPUT_INVALID")
        preflight = None
        if run_preflight:
            preflight = self.postgres_driver.preflight(
                base, inputs.fd("snapshot_postgresql"),
            )
        else:
            inputs.fd("snapshot_postgresql")
        return base, writer_evidence, writer_stage_result_sha256, preflight

    @staticmethod
    def _postgres_execution_evidence(
            inputs: CapabilityInputs, base: dict[str, Any],
            writer_stage_result_sha256: str, restored_oid: str,
            switch_outcome: dict[str, Any], capacity_receipt: dict[str, Any],
            restore_receipt: dict[str, Any], switch_receipt: dict[str, Any],
            restore_precondition: dict[str, Any],
            staging_content_proof: dict[str, Any],
    ) -> dict[str, Any]:
        rows = {
            item["name"]: item for item in switch_outcome["observation"]["databases"]
        }
        active = rows.get(base["databases"]["active_name"])
        quarantine = rows.get(base["databases"]["quarantine_name"])
        if not isinstance(active, dict) or not isinstance(quarantine, dict) \
                or switch_outcome["classification"]["layout"] != "NEW_SEALED" \
                or active["oid"] != restored_oid \
                or quarantine["oid"] != base["databases"]["candidate_oid"]:
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_SWITCH_RESULT_INVALID")
        staging_proof = validate_staging_content_proof(staging_content_proof)
        restore_proof = validate_pg_restore_precondition_envelope(restore_precondition)
        try:
            guarded_opcode = validate_pg_guarded_switch_opcode_spec(
                switch_outcome["opcode"], base=base, inputs=inputs,
            )
        except (KeyError, TypeError):
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_SWITCH_RESULT_INVALID")
        if switch_receipt.get("before_identity_sha256") != staging_proof["proof_sha256"]:
            reject("ROLLBACK_FIXED_EXECUTOR_STAGING_CONTENT_PROOF_INVALID")
        try:
            activation_sha256 = \
                inputs.package["sources"]["snapshot_policy_activation"]["sha256"]
        except (KeyError, TypeError):
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_INPUT_INVALID")
        security = base["security"]
        evidence = {
            "strategy": "RESTORE_TO_STAGING_DATABASE_ATOMIC_RENAME_RETAIN_CANDIDATE_QUARANTINED",
            "source_artifact_sha256": base["snapshot"]["dump_sha256"],
            "source_artifact_bytes": base["snapshot"]["dump_bytes"],
            "source_reconciliation_sha256":
                base["snapshot"]["source_reconciliation_sha256"],
            "target_content_sha256": base["snapshot"]["target_database_report_sha256"],
            "snapshot_database_oid": base["databases"]["candidate_oid"],
            "restored_database_oid": restored_oid,
            "restored_database_name": base["databases"]["active_name"],
            "system_identifier": base["postgres"]["system_identifier"],
            "migration_head": base["snapshot"]["migration_head"],
            "restored_database_marker": base["databases"]["candidate_marker"],
            "staging_database_name": base["databases"]["staging_name"],
            "candidate_database_quarantine_name": base["databases"]["quarantine_name"],
            "candidate_database_quarantine_oid": base["databases"]["candidate_oid"],
            "runtime_plan_sha256": base["runtime_plan_sha256"],
            "manifest_sha256": base["snapshot"]["snapshot_manifest_sha256"],
            "migration_ledger_file_sha256":
                base["snapshot"]["migration_ledger_file_sha256"],
            "migration_manifest_sha256":
                base["snapshot"]["migration_allowlist_sha256"],
            "writer_containment_stage_result_sha256": writer_stage_result_sha256,
            "postgres_container_id": base["postgres"]["container_id"],
            "postgres_image_config_digest": base["postgres"]["image_digest"],
            "database_profile_sha256": base["profile"]["profile_sha256"],
            "postgres_base_spec_sha256": base["base_spec_sha256"],
            "staging_create_receipt_sha256": capacity_receipt["receipt_sha256"],
            "restore_receipt_sha256": restore_receipt["receipt_sha256"],
            "privilege_reconcile_receipt_sha256": staging_proof["binding_sha256"],
            "restore_precondition_opcode_spec_sha256":
                restore_proof["opcode_spec_sha256"],
            "restore_precondition_sha256":
                restore_proof["restore_precondition_sha256"],
            "dump_inventory_sha256": restore_proof["dump_inventory_sha256"],
            "empty_projection_sha256": restore_proof["empty_projection_sha256"],
            "restore_precondition": restore_proof,
            "pre_switch_content_proof_sha256": staging_proof["proof_sha256"],
            "pre_switch_content_proof": staging_proof,
            "runtime_privilege_access_sha256": security["access_sha256"],
            "runtime_privilege_catalog_sha256": security["catalog_sha256"],
            "runtime_privilege_catalog_artifact_sha256":
                security["catalog_artifact_sha256"],
            "runtime_privilege_policy_sha256": security["policy_sha256"],
            "runtime_privilege_operator_policy_sha256":
                security["operator_policy_sha256"],
            "uat_reconciliation_authority_sha256": base["authority"]["authority_sha256"],
            "uat_reconciliation_activation_sha256": activation_sha256,
            "sealed_security_projection_sha256": digest_value(security),
            "staging_database_marker": base["databases"]["staging_marker"],
            "candidate_database_quarantine_marker":
                base["databases"]["quarantine_marker"],
            "guarded_switch_opcode_spec_sha256":
                guarded_opcode["opcode_spec_sha256"],
            "guarded_switch_sql_sha256": guarded_opcode["sql_sha256"],
            "guarded_switch_runner_argv_template_sha256":
                guarded_opcode["argv_template_sha256"],
            "guarded_switch_state_sha256":
                guarded_opcode["bindings"]["guarded_state_sha256"],
            "guarded_switch_expected_identity_sha256":
                guarded_opcode["bindings"]["expected_switched_identity_sha256"],
            "switch_receipt_sha256": switch_receipt["receipt_sha256"],
            "switch_effect_identity_sha256": switch_receipt["after_identity_sha256"],
            "switch_receipt": switch_receipt,
            "restored_database_allow_connections_at_commit": active["allow_connections"],
            "restored_database_connection_limit_at_commit": active["connection_limit"],
            "restored_database_sessions_at_commit": active["sessions"],
            "restored_database_prepared_xacts_at_commit": active["prepared_xacts"],
            "candidate_database_quarantine_allow_connections_at_commit":
                quarantine["allow_connections"],
            "candidate_database_quarantine_connection_limit_at_commit":
                quarantine["connection_limit"],
            "candidate_database_quarantine_sessions_at_commit": quarantine["sessions"],
            "candidate_database_quarantine_prepared_xacts_at_commit":
                quarantine["prepared_xacts"],
        }
        return validate_handler_evidence("ROLLBACK_EXECUTION", "POSTGRESQL_RESTORE", evidence)

    def _execute_postgres(
            self, inputs: CapabilityInputs, effects: DurableSideEffectRecorder,
    ) -> dict[str, Any]:
        (
            base, _writer_evidence, writer_stage_result_sha256, preflight,
        ) = self._postgres_base_context(inputs, run_preflight=True)
        if preflight is None:
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_PREFLIGHT_INVALID")
        created, create_receipt = self._complete_effect(
            inputs, effects, "STAGING_DATABASE_CREATE",
            {"base_spec_sha256": base["base_spec_sha256"],
             "target": base["databases"]["staging_name"]},
            {"opcode": "PG_RB_CAPACITY_THEN_CREATE_STAGING_V1"},
            preflight["observation"]["observation_sha256"],
            lambda: self.postgres_driver.create_staging(
                base, preflight["observation"],
            ),
        )
        restore_precondition = self.postgres_driver.restore_precondition(
            base,
            create_receipt_sha256=create_receipt["receipt_sha256"],
            restored_oid=created["restored_oid"],
            dump_inventory_sha256=
                preflight["dump_inventory"]["inventory_sha256"],
        )["proof"]
        restore_precondition = effects.record_read_only_proof(
            POSTGRES_RESTORE_PRECONDITION_PROOF_NAME, restore_precondition,
        )
        restored, restore_receipt = self._complete_effect(
            inputs, effects, "LOGICAL_DUMP_RESTORE",
            {"staging_oid": created["restored_oid"],
             "dump_sha256": base["snapshot"]["dump_sha256"],
             "dump_inventory_sha256":
                preflight["dump_inventory"]["inventory_sha256"],
             "restore_precondition_sha256":
                restore_precondition["restore_precondition_sha256"],
             "empty_projection_sha256":
                restore_precondition["empty_projection_sha256"]},
            {"opcode": "PG_RB_RESTORE_DUMP_V1"},
            create_receipt["receipt_sha256"],
            lambda: self.postgres_driver.restore_dump(
                base, inputs.fd("snapshot_postgresql"),
                create_receipt_sha256=create_receipt["receipt_sha256"],
                restored_oid=created["restored_oid"],
                before_content_observation_sha256=
                    created["observation"]["observation_sha256"],
                dump_inventory_sha256=
                    preflight["dump_inventory"]["inventory_sha256"],
                restore_precondition=restore_precondition,
            ),
        )
        reconciled, reconcile_receipt = self._complete_effect(
            inputs, effects, "PRIVILEGE_RECONCILE",
            {"staging_oid": restored["restored_oid"],
             "sealed_security_projection_sha256": digest_value(base["security"])},
            {"opcode": "PG_RB_RECONCILE_PRIVILEGES_V1"},
            restore_receipt["receipt_sha256"],
            lambda: self.postgres_driver.reconcile(
                base, inputs, restore_receipt_sha256=restore_receipt["receipt_sha256"],
                restored_oid=restored["restored_oid"],
            ),
        )
        staging_content = self.postgres_driver.prove_staging_content(
            inputs, base, restored_oid=restored["restored_oid"],
            binding_sha256=reconcile_receipt["receipt_sha256"],
        )
        staging_proof = effects.record_read_only_proof(
            STAGING_CONTENT_PROOF_NAME,
            build_staging_content_proof(
                staging_content, base, reconcile_receipt["receipt_sha256"],
            ),
        )
        switch_opcode = self.postgres_driver.guarded_switch_opcode(
            base, inputs,
            privilege_receipt_sha256=reconcile_receipt["receipt_sha256"],
            staging_content_proof_sha256=staging_proof["proof_sha256"],
            restored_oid=restored["restored_oid"],
            before_observation_sha256=staging_content["after"]["observation_sha256"],
        )
        switch_target = postgres_guarded_switch_intent_target(
            switch_opcode,
            restored_oid=restored["restored_oid"],
            candidate_oid=base["databases"]["candidate_oid"],
            staging_content_proof_sha256=staging_proof["proof_sha256"],
        )
        switch_argv = postgres_guarded_switch_intent_argv(switch_opcode)
        switched, switch_receipt = self._complete_effect(
            inputs, effects, "DATABASE_SWITCH",
            switch_target,
            switch_argv,
            staging_proof["proof_sha256"],
            lambda: self.postgres_driver.execute_guarded_switch(
                base, inputs, opcode=switch_opcode,
                restored_oid=restored["restored_oid"],
            ),
            receipt_identity=lambda outcome: postgres_layout_effect_identity(
                outcome["observation"], outcome["classification"],
                expected_layout="NEW_SEALED", restored_oid=restored["restored_oid"],
            ),
        )
        return self._postgres_execution_evidence(
            inputs, base, writer_stage_result_sha256, restored["restored_oid"],
            switched, create_receipt, restore_receipt, switch_receipt,
            restore_precondition, staging_proof,
        )

    def _recover_postgres_execution(
            self, inputs: CapabilityInputs, effects: DurableSideEffectRecorder,
    ) -> dict[str, Any]:
        receipts = {
            name: effects.receipt(name) for name in SIDE_EFFECTS_BY_LABEL["POSTGRESQL_RESTORE"]
        }
        if any(receipts[name] is None for name in (
                "STAGING_DATABASE_CREATE", "LOGICAL_DUMP_RESTORE", "PRIVILEGE_RECONCILE",
        )):
            raise HandlerOutcomeUnknown(
                "PROBE_INCONCLUSIVE", "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            )
        create_receipt = receipts["STAGING_DATABASE_CREATE"]
        restore_receipt = receipts["LOGICAL_DUMP_RESTORE"]
        reconcile_receipt = receipts["PRIVILEGE_RECONCILE"]
        switch_receipt = receipts["DATABASE_SWITCH"]
        restore_precondition = effects.read_only_proof(
            POSTGRES_RESTORE_PRECONDITION_PROOF_NAME,
        )
        staging_proof = effects.read_only_proof(STAGING_CONTENT_PROOF_NAME)
        assert create_receipt is not None and restore_receipt is not None \
            and reconcile_receipt is not None
        base, _writer, writer_stage_result_sha256, _preflight = \
            self._postgres_base_context(inputs, run_preflight=False)
        try:
            prefix_is_bound = \
                restore_receipt["before_identity_sha256"] == create_receipt["receipt_sha256"] \
                and reconcile_receipt["before_identity_sha256"] \
                    == restore_receipt["receipt_sha256"]
        except (KeyError, TypeError):
            prefix_is_bound = False
        if not prefix_is_bound:
            raise HandlerOutcomeUnknown(
                "DURABLE_STATE_DIVERGED", "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            )
        if staging_proof is None:
            raise HandlerOutcomeUnknown(
                "DURABLE_STATE_MISSING", "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            )
        if restore_precondition is None:
            raise HandlerOutcomeUnknown(
                "DURABLE_STATE_MISSING", "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            )
        try:
            inventory = self.postgres_driver.dump_inventory(
                base, inputs.fd("snapshot_postgresql"),
            )
        except FixedExecutorError as error:
            raise HandlerOutcomeUnknown(
                "SOURCE_IDENTITY_DRIFT", "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            ) from error
        try:
            precondition_opcode = derive_pg_opcode_spec(
                base, "PG_RB_OBSERVE_STAGING_RESTORE_PRECONDITION_V1", {
                    "create_receipt_sha256": create_receipt["receipt_sha256"],
                    "staging_oid": restore_precondition["database"]["oid"],
                    "dump_inventory_sha256": inventory["inventory_sha256"],
                    "expected_empty_projection_sha256":
                        digest_value(postgres_empty_restore_projection()),
                },
            )
            restore_precondition = validate_pg_restore_precondition_proof(
                restore_precondition, base=base, opcode_spec=precondition_opcode,
            )
        except (FixedExecutorError, KeyError, TypeError) as error:
            raise HandlerOutcomeUnknown(
                "DURABLE_STATE_DIVERGED", "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            ) from error
        try:
            switch_intent = effects.started_intent("DATABASE_SWITCH")
            if switch_intent is None:
                raise ValueError("switch was not durably started")
            restored_oid = staging_proof["staging_database_oid"]
            if staging_proof["binding_sha256"] != reconcile_receipt["receipt_sha256"] \
                    or staging_proof["base_spec_sha256"] != base["base_spec_sha256"] \
                    or staging_proof["runtime_plan_sha256"] \
                        != base["runtime_plan_sha256"] \
                    or OID.fullmatch(restored_oid or "") is None \
                    or restore_precondition["database"]["oid"] != restored_oid \
                    or staging_proof["candidate_database_oid"] \
                        != base["databases"]["candidate_oid"]:
                raise ValueError("durable staging proof drift")
            switch_opcode = self.postgres_driver.guarded_switch_opcode(
                base, inputs,
                privilege_receipt_sha256=reconcile_receipt["receipt_sha256"],
                staging_content_proof_sha256=staging_proof["proof_sha256"],
                restored_oid=restored_oid,
                before_observation_sha256=
                    staging_proof["after_observation_sha256"],
            )
            expected_targets = {
                "STAGING_DATABASE_CREATE": {
                    "base_spec_sha256": base["base_spec_sha256"],
                    "target": base["databases"]["staging_name"],
                },
                "LOGICAL_DUMP_RESTORE": {
                    "staging_oid": restored_oid,
                    "dump_sha256": base["snapshot"]["dump_sha256"],
                    "dump_inventory_sha256": inventory["inventory_sha256"],
                    "restore_precondition_sha256":
                        restore_precondition["restore_precondition_sha256"],
                    "empty_projection_sha256":
                        restore_precondition["empty_projection_sha256"],
                },
                "PRIVILEGE_RECONCILE": {
                    "staging_oid": restored_oid,
                    "sealed_security_projection_sha256": digest_value(base["security"]),
                },
                "DATABASE_SWITCH": postgres_guarded_switch_intent_target(
                    switch_opcode, restored_oid=restored_oid,
                    candidate_oid=base["databases"]["candidate_oid"],
                    staging_content_proof_sha256=staging_proof["proof_sha256"],
                ),
            }
            expected_argv = {
                "STAGING_DATABASE_CREATE": {
                    "opcode": "PG_RB_CAPACITY_THEN_CREATE_STAGING_V1",
                },
                "LOGICAL_DUMP_RESTORE": {"opcode": "PG_RB_RESTORE_DUMP_V1"},
                "PRIVILEGE_RECONCILE": {
                    "opcode": "PG_RB_RECONCILE_PRIVILEGES_V1",
                },
                "DATABASE_SWITCH": postgres_guarded_switch_intent_argv(switch_opcode),
            }
            intents = {
                name: effects.started_intent(name)
                for name in SIDE_EFFECTS_BY_LABEL["POSTGRESQL_RESTORE"]
            }
            if any(intent is None for intent in intents.values()) or any(
                    intents[name]["target_identity_sha256"] \
                        != digest_value(expected_targets[name])
                    or intents[name]["argv_template_sha256"] \
                        != digest_value(expected_argv[name])
                    for name in intents
            ):
                raise ValueError("durable PostgreSQL intent drift")
            observation = self.postgres_driver.observe(
                base, "recover-switch", switch_intent["intent_sha256"],
            )
            classification = classify_pg_rollback_layout(
                observation, base=base, restored_oid=restored_oid,
            )
        except (FixedExecutorError, KeyError, TypeError, ValueError) as error:
            raise HandlerOutcomeUnknown(
                "TARGET_IDENTITY_DRIFT", "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            ) from error

        if switch_receipt is None and classification["layout"] == "OLD":
            try:
                should_execute = effects.begin_recovery(
                    "DATABASE_SWITCH", opcode=switch_opcode,
                    before_observation_sha256=observation["observation_sha256"],
                    candidate_oid=base["databases"]["candidate_oid"],
                )
            except FixedExecutorError as error:
                raise HandlerOutcomeUnknown(
                    "DURABLE_STATE_DIVERGED", "PROBE", side_effects_started=True,
                    uncertain_action="EXECUTE",
                ) from error
            if not should_execute:
                raise HandlerOutcomeUnknown(
                    "SIDE_EFFECT_OUTCOME_UNKNOWN", "PROBE", side_effects_started=True,
                    uncertain_action="EXECUTE",
                )
            try:
                switched = self.postgres_driver.execute_guarded_switch(
                    base, inputs, opcode=switch_opcode, restored_oid=restored_oid,
                )
                observation = switched["observation"]
                classification = switched["classification"]
            except HandlerOutcomeUnknown as error:
                raise HandlerOutcomeUnknown(
                    error.reason_code, error.phase, side_effects_started=True,
                    uncertain_action="EXECUTE",
                ) from error
            except Exception as error:
                raise HandlerOutcomeUnknown(
                    "SIDE_EFFECT_OUTCOME_UNKNOWN", "AFTER_SIDE_EFFECT",
                    side_effects_started=True, uncertain_action="EXECUTE",
                ) from error

        if classification["layout"] != "NEW_SEALED":
            raise HandlerOutcomeUnknown(
                "TARGET_IDENTITY_DRIFT", "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            )
        try:
            effect_identity = postgres_layout_effect_identity(
                observation, classification, expected_layout="NEW_SEALED",
                restored_oid=restored_oid,
            )
        except FixedExecutorError as error:
            raise HandlerOutcomeUnknown(
                "TARGET_IDENTITY_DRIFT", "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            ) from error

        if switch_receipt is None:
            switch_receipt = create_recovered_side_effect_receipt(
                switch_intent, staging_proof["proof_sha256"],
                digest_value(effect_identity),
                observation["observation_sha256"], self.clock(),
            )
            effects.complete("DATABASE_SWITCH", switch_receipt)
        elif switch_receipt.get("before_identity_sha256") \
                != staging_proof["proof_sha256"] \
                or switch_receipt.get("after_identity_sha256") \
                    != digest_value(effect_identity):
            raise HandlerOutcomeUnknown(
                "DURABLE_STATE_DIVERGED", "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            )
        return self._postgres_execution_evidence(
            inputs, base, writer_stage_result_sha256, restored_oid,
            {"opcode": switch_opcode, "observation": observation,
             "classification": classification},
            create_receipt, restore_receipt, switch_receipt,
            restore_precondition, staging_proof,
        )

    @staticmethod
    def _volume_domain(label: str) -> str:
        mapping = {
            "UPLOADS_RESTORE": "uploads", "ATTACHMENTS_RESTORE": "attachments",
            "BACKUP_STATUS_RESTORE": "backup_status", "UPLOADS_CONTENT": "uploads",
            "ATTACHMENTS_CONTENT": "attachments",
            "BACKUP_STATUS_CONTENT": "backup_status",
        }
        if label not in mapping:
            reject("ROLLBACK_FIXED_EXECUTOR_DISPATCH_INVALID")
        return mapping[label]

    def _prepared_volume(
            self, label: str, inputs: CapabilityInputs, *, target_present: bool,
    ) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        if self.volume_driver is None:
            self._unsupported(label)
        domain = self._volume_domain(label)
        spec = derive_volume_restore_spec(inputs, domain)
        metadata_policy = volume_metadata_policy(domain, spec["backup_status_reader_gid"])
        if metadata_policy["metadata_policy_sha256"] != spec["metadata_policy_sha256"]:
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_METADATA_POLICY_INVALID")
        archive_fd = inputs.fd(spec["source_role"])
        inventory = inspect_safe_tar_gzip(
            archive_fd, spec["source_artifact_sha256"], spec["source_artifact_bytes"],
            spec["source_entries"], metadata_policy=metadata_policy,
        )
        if inventory["file_tree_sha256"] != spec["expected_tree_sha256"] \
                or not SHA256.fullmatch(
                    inventory.get("expected_metadata_state_sha256") or "",
                ):
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_ARCHIVE_TREE_MISMATCH")
        preflight = self.volume_driver.preflight(spec, target_present=target_present)
        return spec, inventory, preflight

    def _complete_effect(
            self, inputs: CapabilityInputs, effects: DurableSideEffectRecorder, name: str,
            target: dict[str, Any], argv: dict[str, Any], before: str,
            callback: Any, *, receipt_identity: Any = None,
    ) -> tuple[Any, dict[str, Any]]:
        request = inputs.request
        uncertain_action = request.get("action") or (
            "PROBE" if request.get("operation") == "ROLLBACK_POSTVERIFY" else "EXECUTE"
        )
        intent = create_side_effect_intent(
            request, name, digest_value(target), digest_value(argv), self.clock(),
        )
        effects.begin(name, intent)
        try:
            outcome = callback()
            after_identity_sha256 = digest_value(
                outcome if receipt_identity is None else receipt_identity(outcome),
            )
            receipt = create_side_effect_receipt(
                intent, before, after_identity_sha256, self.clock(),
            )
            effects.complete(name, receipt)
            return outcome, receipt
        except HandlerOutcomeUnknown as error:
            raise HandlerOutcomeUnknown(
                error.reason_code, error.phase, side_effects_started=True,
                uncertain_action=error.uncertain_action or uncertain_action,
            ) from error
        except FixedExecutorError as error:
            reason = "SOURCE_IDENTITY_DRIFT" \
                if error.code in VOLUME_SOURCE_DRIFT_CODES \
                else "TARGET_IDENTITY_DRIFT"
            raise HandlerOutcomeUnknown(
                reason, "AFTER_SIDE_EFFECT", side_effects_started=True,
                uncertain_action=uncertain_action,
            ) from error
        except Exception as error:
            raise HandlerOutcomeUnknown(
                "SIDE_EFFECT_OUTCOME_UNKNOWN", "AFTER_SIDE_EFFECT",
                side_effects_started=True, uncertain_action=uncertain_action,
            ) from error

    @staticmethod
    def _volume_execution_evidence(
            label: str, spec: dict[str, Any], inventory: dict[str, Any],
            target: dict[str, Any], capacity_receipt: dict[str, Any],
            restore_receipt: dict[str, Any],
    ) -> dict[str, Any]:
        domain = spec["domain"]
        target_root_identity = digest_value({
            "domain": domain,
            "target_volume_identity_sha256": target["target_volume_identity_sha256"],
            "metadata_state_sha256": inventory["expected_metadata_state_sha256"],
            "metadata_policy_sha256": spec["metadata_policy_sha256"],
        })
        evidence = {
            "strategy": "RESTORE_TO_NEW_NAMED_VOLUMES_RECREATE_WRITERS_RETAIN_CANDIDATE_VOLUMES",
            "source_artifact_sha256": spec["source_artifact_sha256"],
            "source_artifact_bytes": spec["source_artifact_bytes"],
            "source_entries": spec["source_entries"],
            "source_reconciliation_sha256": spec["source_reconciliation_sha256"],
            "target_content_sha256": spec["expected_tree_sha256"],
            "target_volume": spec["target_volume"],
            "target_volume_identity_sha256": target["target_volume_identity_sha256"],
            "retained_candidate_volume": spec["candidate_volume"],
            "retained_candidate_volume_identity_sha256":
                spec["candidate_volume_identity_sha256"],
            "runtime_plan_sha256": spec["runtime_plan_sha256"], "domain": domain,
            "manifest_sha256": spec["manifest_sha256"],
            "expected_tree_sha256": spec["expected_tree_sha256"],
            "target_volume_marker_sha256": target["target_volume_marker_sha256"],
            "target_root_identity_sha256": target_root_identity,
            "metadata_policy_sha256": spec["metadata_policy_sha256"],
            "metadata_state_sha256": inventory["expected_metadata_state_sha256"],
            "capacity_receipt_sha256": capacity_receipt["receipt_sha256"],
            "volume_restore_receipt_sha256": restore_receipt["receipt_sha256"],
            "helper_image_reference": spec["helper_image_reference"],
            "helper_image_config_digest": spec["helper_image_config_digest"],
            "archive_inventory_sha256": inventory["inventory_sha256"],
        }
        if domain == "backup_status":
            evidence.update({
                "backup_status_disposition": BACKUP_STATUS_DISPOSITION,
                "current_backup_readiness": False, "post_rollback_backup_required": True,
            })
        return validate_handler_evidence("ROLLBACK_EXECUTION", label, evidence)

    def _execute_volume(
            self, label: str, inputs: CapabilityInputs, effects: DurableSideEffectRecorder,
    ) -> dict[str, Any]:
        spec, inventory, preflight = self._prepared_volume(
            label, inputs, target_present=False,
        )
        domain = spec["domain"]
        absent_identity = digest_value({
            "domain": domain, "target_volume": spec["target_volume"], "present": False,
            "candidate_volume_identity_sha256": spec["candidate_volume_identity_sha256"],
        })

        def create_target() -> dict[str, Any]:
            capacity = self.volume_driver.capacity(spec)
            observations = {item: dict(capacity["observation"])
                            for item in ("uploads", "attachments", "backup_status")}
            requirements = {
                item: {"required_bytes": 0, "required_inodes": 0}
                for item in ("uploads", "attachments", "backup_status")
            }
            requirements[domain] = {
                "required_bytes": inventory["uncompressed_bytes"],
                "required_inodes": inventory["entries"] + inventory["directories"],
            }
            budget = validate_volume_capacity_budget(observations, requirements)
            target = self.volume_driver.create_target(spec)
            return {"capacity": capacity, "capacity_budget": budget, "target": target}

        target_outcome, target_receipt = self._complete_effect(
            inputs, effects, "TARGET_VOLUME_CREATE",
            {"restore_spec_sha256": spec["restore_spec_sha256"], "state": "ABSENT"},
            {"opcode": "CAPACITY_THEN_CREATE_DERIVED_VOLUME", "domain": domain},
            absent_identity, create_target,
        )
        target = target_outcome["target"]
        restore_outcome, restore_receipt = self._complete_effect(
            inputs, effects, "ARCHIVE_RESTORE",
            {"target_volume_identity_sha256": target["target_volume_identity_sha256"],
             "source_artifact_sha256": spec["source_artifact_sha256"]},
            {"opcode": "VOLUME_HELPER_RESTORE", "domain": domain,
             "helper_image_config_digest": spec["helper_image_config_digest"]},
            target["target_volume_identity_sha256"],
            lambda: self.volume_driver.restore(
                spec, inputs.fd(spec["source_role"]),
            ),
        )

        def reconcile_and_probe() -> dict[str, Any]:
            reconciled = self.volume_driver.reconcile(spec)
            probe = self.volume_driver.probe(spec)
            return {"reconciled": reconciled, "probe": probe}

        metadata_outcome, _metadata_receipt = self._complete_effect(
            inputs, effects, "METADATA_RECONCILE",
            {"target_volume_identity_sha256": target["target_volume_identity_sha256"],
             "metadata_policy_sha256": spec["metadata_policy_sha256"]},
            {"opcode": "VOLUME_HELPER_RECONCILE_THEN_PROBE", "domain": domain},
            restore_receipt["receipt_sha256"], reconcile_and_probe,
        )
        probe = metadata_outcome["probe"]

        def remove_and_validate() -> dict[str, Any]:
            removed_identity_sha256 = self.volume_driver.remove_utility(spec)
            if probe["file_tree_sha256"] != spec["expected_tree_sha256"] \
                    or probe["entries"] != spec["source_entries"] \
                    or probe["uncompressed_bytes"] != inventory["uncompressed_bytes"] \
                    or probe["metadata_state_sha256"] \
                        != inventory["expected_metadata_state_sha256"]:
                reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_RESTORE_CONTENT_MISMATCH")
            return {"removed_identity_sha256": removed_identity_sha256}

        remove_outcome, _remove_receipt = self._complete_effect(
            inputs, effects, "UTILITY_REMOVE",
            {"utility_container": spec["utility_container"],
             "container_id": probe["container_id"]},
            {"opcode": "DOCKER_REMOVE_VERIFIED_HELPER", "domain": domain},
            probe["exited_identity_sha256"],
            remove_and_validate,
        )
        if remove_outcome["removed_identity_sha256"] == ZERO_SHA256 \
                or preflight["helper_image_admission_sha256"] == ZERO_SHA256:
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_RESTORE_RESULT_INVALID")
        return self._volume_execution_evidence(
            label, spec, inventory, target, target_receipt, restore_receipt,
        )

    def _recover_volume_execution(
            self, label: str, inputs: CapabilityInputs,
            effects: DurableSideEffectRecorder,
    ) -> dict[str, Any]:
        receipts = {
            name: effects.receipt(name) for name in SIDE_EFFECTS_BY_LABEL[label]
        }
        if any(receipt is None for receipt in receipts.values()):
            raise HandlerOutcomeUnknown(
                "PROBE_INCONCLUSIVE", "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            )
        capacity_receipt = receipts["TARGET_VOLUME_CREATE"]
        restore_receipt = receipts["ARCHIVE_RESTORE"]
        metadata_receipt = receipts["METADATA_RECONCILE"]
        remove_receipt = receipts["UTILITY_REMOVE"]
        assert capacity_receipt is not None and restore_receipt is not None \
            and metadata_receipt is not None and remove_receipt is not None
        try:
            spec, inventory, preflight = self._prepared_volume(
                label, inputs, target_present=True,
            )
        except FixedExecutorError as error:
            raise HandlerOutcomeUnknown(
                "SOURCE_IDENTITY_DRIFT" if error.code in VOLUME_SOURCE_DRIFT_CODES
                else "TARGET_IDENTITY_DRIFT",
                "PROBE", side_effects_started=True, uncertain_action="EXECUTE",
            ) from error
        absent_identity = digest_value({
            "domain": spec["domain"], "target_volume": spec["target_volume"],
            "present": False,
            "candidate_volume_identity_sha256": spec["candidate_volume_identity_sha256"],
        })
        if capacity_receipt["before_identity_sha256"] != absent_identity \
                or metadata_receipt["before_identity_sha256"] \
                    != restore_receipt["receipt_sha256"] \
                or preflight["helper_image_admission_sha256"] == ZERO_SHA256 \
                or preflight["candidate_volume_identity_sha256"] \
                    != spec["candidate_volume_identity_sha256"] \
                or remove_receipt["after_identity_sha256"] == ZERO_SHA256:
            raise HandlerOutcomeUnknown(
                "DURABLE_STATE_DIVERGED", "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            )
        try:
            target = self.volume_driver.observe_target(
                spec, restore_receipt["before_identity_sha256"],
            )
        except FixedExecutorError as error:
            raise HandlerOutcomeUnknown(
                "SOURCE_IDENTITY_DRIFT" if error.code in VOLUME_SOURCE_DRIFT_CODES
                else "TARGET_IDENTITY_DRIFT",
                "PROBE", side_effects_started=True,
                uncertain_action="EXECUTE",
            ) from error
        return self._volume_execution_evidence(
            label, spec, inventory, target, capacity_receipt, restore_receipt,
        )

    def _postgres_content_context(
            self, inputs: CapabilityInputs,
    ) -> tuple[dict[str, Any], dict[str, Any], str, dict[str, Any]]:
        code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_POSTVERIFY_INPUT_INVALID"
        if self.postgres_driver is None:
            self._unsupported("POSTGRESQL_CONTENT")
        base = derive_pg_rollback_base_spec(inputs)
        try:
            stage = inputs.rollback_result["stages"][2]
            stage_evidence = validate_handler_evidence(
                "ROLLBACK_EXECUTION", "POSTGRESQL_RESTORE", stage["evidence"],
            )
            stage_result_sha256 = stage["stage_result_sha256"]
            activation = validate_handler_evidence(
                "ROLLBACK_EXECUTION", "WEB_WORKER_PREDECESSOR_ACTIVATION",
                inputs.rollback_result["stages"][7]["evidence"],
            )
        except (KeyError, TypeError, IndexError, FixedExecutorError):
            reject(code)
        security = base["security"]
        expected = {
            "source_artifact_sha256": base["snapshot"]["dump_sha256"],
            "source_artifact_bytes": base["snapshot"]["dump_bytes"],
            "source_reconciliation_sha256":
                base["snapshot"]["source_reconciliation_sha256"],
            "target_content_sha256":
                base["snapshot"]["target_database_report_sha256"],
            "restored_database_name": base["databases"]["active_name"],
            "system_identifier": base["postgres"]["system_identifier"],
            "migration_head": base["snapshot"]["migration_head"],
            "restored_database_marker": base["databases"]["candidate_marker"],
            "candidate_database_quarantine_name":
                base["databases"]["quarantine_name"],
            "candidate_database_quarantine_oid": base["databases"]["candidate_oid"],
            "runtime_plan_sha256": base["runtime_plan_sha256"],
            "manifest_sha256": base["snapshot"]["snapshot_manifest_sha256"],
            "migration_ledger_file_sha256":
                base["snapshot"]["migration_ledger_file_sha256"],
            "migration_manifest_sha256":
                base["snapshot"]["migration_allowlist_sha256"],
            "postgres_container_id": base["postgres"]["container_id"],
            "postgres_image_config_digest": base["postgres"]["image_digest"],
            "database_profile_sha256": base["profile"]["profile_sha256"],
            "runtime_privilege_access_sha256": security["access_sha256"],
            "runtime_privilege_catalog_sha256": security["catalog_sha256"],
            "runtime_privilege_catalog_artifact_sha256":
                security["catalog_artifact_sha256"],
            "runtime_privilege_policy_sha256": security["policy_sha256"],
            "runtime_privilege_operator_policy_sha256":
                security["operator_policy_sha256"],
            "uat_reconciliation_authority_sha256": base["authority"]["authority_sha256"],
            "sealed_security_projection_sha256": digest_value(security),
            "candidate_database_quarantine_marker":
                base["databases"]["quarantine_marker"],
        }
        if not SHA256.fullmatch(stage_result_sha256 or "") \
                or stage_evidence["restored_database_oid"] \
                    == base["databases"]["candidate_oid"] \
                or OID.fullmatch(stage_evidence["restored_database_oid"]) is None \
                or any(stage_evidence[field] != value for field, value in expected.items()) \
                or activation["runtime_plan_sha256"] != base["runtime_plan_sha256"] \
                or activation["uat_reconciliation_authority_sha256"] \
                    != stage_evidence["uat_reconciliation_authority_sha256"] \
                or activation["uat_reconciliation_activation_sha256"] \
                    != stage_evidence["uat_reconciliation_activation_sha256"] \
                or activation["sealed_security_projection_sha256"] \
                    != stage_evidence["sealed_security_projection_sha256"] \
                or activation["active_database_allow_connections"] is not True \
                or activation["active_database_connection_limit"] != 64 \
                or activation["candidate_database_quarantine_allow_connections"] \
                    is not False \
                or activation["candidate_database_quarantine_connection_limit"] != 0:
            reject(code)
        proof = validate_preactivation_content_proof(
            activation["preactivation_content_proof"], code,
        )
        expected_proof = {
            "binding_sha256": activation["database_unseal_receipt_sha256"],
            "runtime_plan_sha256": base["runtime_plan_sha256"],
            "source_reconciliation_sha256":
                base["snapshot"]["source_reconciliation_sha256"],
            "source_database_report_sha256":
                base["snapshot"]["target_database_report_sha256"],
            "live_database_report_sha256":
                base["snapshot"]["target_database_report_sha256"],
            "migration_head": base["snapshot"]["migration_head"],
            "migration_ledger_file_sha256":
                base["snapshot"]["migration_ledger_file_sha256"],
            "migration_allowlist_sha256":
                base["snapshot"]["migration_allowlist_sha256"],
            "restored_database_oid": stage_evidence["restored_database_oid"],
            "restored_database_marker": base["databases"]["candidate_marker"],
            "system_identifier": base["postgres"]["system_identifier"],
            "candidate_database_quarantine_name":
                base["databases"]["quarantine_name"],
            "candidate_database_quarantine_oid": base["databases"]["candidate_oid"],
            "candidate_database_quarantine_marker":
                base["databases"]["quarantine_marker"],
        }
        if any(proof[field] != value for field, value in expected_proof.items()):
            reject(code)
        return base, stage_evidence, stage_result_sha256, activation

    def _postgres_content_evidence(
            self, inputs: CapabilityInputs,
    ) -> dict[str, Any]:
        base, stage, stage_result_sha256, activation = \
            self._postgres_content_context(inputs)
        observed = self.postgres_driver.postverify_content(
            inputs, base, restored_oid=stage["restored_database_oid"],
            binding_sha256=activation["rollback_postdeploy_receipt_sha256"],
            require_zero_writer_sessions=False,
        )
        active = observed["active"]
        quarantine = observed["quarantine"]
        source_report = observed["source_report"]
        live_report = observed["live_report"]
        migration = observed["migration"]
        live_security = observed["security"]
        sessions = observed["sessions"]
        identity = observed["identity"]
        security = base["security"]
        evidence = {
            "source_artifact_sha256": base["snapshot"]["dump_sha256"],
            "source_artifact_bytes": base["snapshot"]["dump_bytes"],
            "source_reconciliation_sha256": source_report["source_sha256"],
            "target_content_sha256": live_report["sha256"],
            "target_identity_sha256": identity["identity_sha256"],
            "stage_result_sha256": stage_result_sha256, "entries": None,
            "candidate_database_quarantine_name": quarantine["name"],
            "candidate_database_quarantine_oid": quarantine["oid"],
            "candidate_database_quarantine_present": True,
            "runtime_plan_sha256": base["runtime_plan_sha256"],
            "restored_database_oid": identity["oid"],
            "restored_database_marker": identity["marker"],
            "system_identifier": identity["system_identifier"],
            "migration_head": migration["head"],
            "migration_ledger_file_sha256": migration["ledger_file_sha256"],
            "migration_manifest_sha256": migration["allowlist_sha256"],
            "restore_receipt_sha256": stage["restore_receipt_sha256"],
            "runtime_privilege_access_sha256": security["access_sha256"],
            "runtime_privilege_catalog_sha256": security["catalog_sha256"],
            "runtime_privilege_catalog_artifact_sha256":
                security["catalog_artifact_sha256"],
            "runtime_privilege_policy_sha256": security["policy_sha256"],
            "runtime_privilege_operator_policy_sha256":
                security["operator_policy_sha256"],
            "uat_reconciliation_authority_sha256": base["authority"]["authority_sha256"],
            "uat_reconciliation_activation_sha256":
                stage["uat_reconciliation_activation_sha256"],
            "sealed_security_projection_sha256": digest_value(security),
            "live_security_state_sha256": live_security["state_sha256"],
            "active_allow_connections": active["allow_connections"],
            "active_connection_limit": active["connection_limit"],
            "active_default_transaction_read_only":
                active["default_transaction_read_only"],
            "active_allowed_session_role_set_sha256":
                sessions["allowed_role_set_sha256"],
            "active_session_observation_sha256":
                sessions["observation_sha256"],
            "active_session_client_policy_sha256":
                sessions["client_policy_sha256"],
            "active_writer_session_count": sessions["total"],
            "active_unexpected_session_count": 0,
            "active_prepared_xacts": active["prepared_xacts"],
            "candidate_database_quarantine_marker":
                quarantine["marker"],
            "candidate_database_quarantine_allow_connections":
                quarantine["allow_connections"],
            "candidate_database_quarantine_connection_limit":
                quarantine["connection_limit"],
            "candidate_database_quarantine_sessions":
                quarantine["sessions"],
            "candidate_database_quarantine_prepared_xacts":
                quarantine["prepared_xacts"],
        }
        return validate_handler_evidence(
            "ROLLBACK_POSTVERIFY", "POSTGRESQL_CONTENT", evidence,
        )

    def _migration_head_context(
            self, inputs: CapabilityInputs,
    ) -> tuple[dict[str, Any], str]:
        code = "ROLLBACK_FIXED_EXECUTOR_MIGRATION_HEAD_INPUT_INVALID"
        if self.postgres_driver is None:
            self._unsupported("MIGRATION_HEAD")
        try:
            stage = inputs.rollback_result["stages"][2]
            evidence = validate_handler_evidence(
                "ROLLBACK_EXECUTION", "POSTGRESQL_RESTORE", stage["evidence"],
            )
            stage_result_sha256 = stage["stage_result_sha256"]
            plan = inputs.plan
            predecessor = inputs.package["predecessor"]
        except (KeyError, TypeError, IndexError, FixedExecutorError):
            reject(code)
        if not SHA256.fullmatch(stage_result_sha256 or "") \
                or evidence["runtime_plan_sha256"] != plan["runtime_plan_sha256"] \
                or evidence["restored_database_name"] \
                    != plan["targets"]["database"]["active"] \
                or evidence["migration_head"] != predecessor.get("migration_head") \
                or evidence["migration_manifest_sha256"] \
                    != predecessor.get("migration_manifest_sha256") \
                or evidence["migration_ledger_file_sha256"] \
                    != inputs.package["sources"]["snapshot_migrations"].get("sha256"):
            reject(code)
        validate_predecessor_migration_binding(
            inputs, expected_head=evidence["migration_head"],
            expected_sha256=evidence["migration_manifest_sha256"],
        )
        validate_migration_ledger(
            inputs.raw("snapshot_migrations"),
            expected_ledger_file_sha256=evidence["migration_ledger_file_sha256"],
            expected_allowlist_sha256=evidence["migration_manifest_sha256"],
            expected_head=evidence["migration_head"],
        )
        return evidence, stage_result_sha256

    def _migration_head_evidence(
            self, inputs: CapabilityInputs,
    ) -> dict[str, Any]:
        stage, stage_result_sha256 = self._migration_head_context(inputs)
        observed = self.postgres_driver.postverify_migration_head(
            inputs, database=stage["restored_database_name"],
            restored_oid=stage["restored_database_oid"],
            system_identifier=stage["system_identifier"],
            marker=stage["restored_database_marker"],
            expected_head=stage["migration_head"],
            expected_ledger_file_sha256=stage["migration_ledger_file_sha256"],
            expected_allowlist_sha256=stage["migration_manifest_sha256"],
        )
        return validate_handler_evidence(
            "ROLLBACK_POSTVERIFY", "MIGRATION_HEAD", {
                "migration_head": observed["migration"]["head"],
                "migration_ledger_file_sha256":
                    observed["migration"]["ledger_file_sha256"],
                "migration_manifest_sha256":
                    observed["migration"]["allowlist_sha256"],
                "database_identity_sha256":
                    observed["identity"]["identity_sha256"],
                "postgresql_stage_result_sha256": stage_result_sha256,
            },
        )

    def _volume_postverify_context(
            self, label: str, inputs: CapabilityInputs,
    ) -> tuple[
        dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any], str, dict[str, Any],
    ]:
        spec, inventory, preflight = self._prepared_volume(
            label, inputs, target_present=True,
        )
        domain = spec["domain"]
        stage_index = {"uploads": 3, "attachments": 4, "backup_status": 5}[domain]
        try:
            stage = inputs.rollback_result["stages"][stage_index]
            stage_evidence = validate_handler_evidence(
                "ROLLBACK_EXECUTION", f"{domain.upper()}_RESTORE", stage["evidence"],
            )
            stage_result_sha256 = stage["stage_result_sha256"]
        except (KeyError, TypeError, IndexError, FixedExecutorError):
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_POSTVERIFY_INPUT_INVALID")
        if not SHA256.fullmatch(stage_result_sha256 or "") \
                or stage_evidence["target_volume"] != spec["target_volume"] \
                or stage_evidence["expected_tree_sha256"] != spec["expected_tree_sha256"] \
                or stage_evidence["metadata_state_sha256"] \
                    != inventory["expected_metadata_state_sha256"] \
                or stage_evidence["retained_candidate_volume_identity_sha256"] \
                    != spec["candidate_volume_identity_sha256"]:
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_POSTVERIFY_INPUT_INVALID")
        target = self.volume_driver.observe_target(
            spec, stage_evidence["target_volume_identity_sha256"],
        )
        return (
            spec, inventory, preflight, stage_evidence, stage_result_sha256, target,
        )

    @staticmethod
    def _volume_postverify_evidence(
            label: str, spec: dict[str, Any], inventory: dict[str, Any],
            stage_evidence: dict[str, Any], stage_result_sha256: str,
            target: dict[str, Any],
    ) -> dict[str, Any]:
        domain = spec["domain"]
        evidence = {
            "source_artifact_sha256": spec["source_artifact_sha256"],
            "source_artifact_bytes": spec["source_artifact_bytes"],
            "source_reconciliation_sha256": spec["source_reconciliation_sha256"],
            "target_content_sha256": spec["expected_tree_sha256"],
            "target_identity_sha256": target["target_volume_identity_sha256"],
            "stage_result_sha256": stage_result_sha256, "entries": spec["source_entries"],
            "candidate_volume_name": spec["candidate_volume"],
            "candidate_volume_identity_sha256": spec["candidate_volume_identity_sha256"],
            "candidate_volume_present": True, "domain": domain,
            "runtime_plan_sha256": spec["runtime_plan_sha256"],
            "target_volume": spec["target_volume"],
            "target_volume_marker_sha256": target["target_volume_marker_sha256"],
            "expected_tree_sha256": spec["expected_tree_sha256"],
            "target_root_identity_sha256": stage_evidence["target_root_identity_sha256"],
            "metadata_policy_sha256": spec["metadata_policy_sha256"],
            "metadata_state_sha256": inventory["expected_metadata_state_sha256"],
            "volume_restore_receipt_sha256": stage_evidence["volume_restore_receipt_sha256"],
            "helper_image_config_digest": spec["helper_image_config_digest"],
        }
        if domain == "backup_status":
            evidence.update({
                "backup_status_disposition": BACKUP_STATUS_DISPOSITION,
                "current_backup_readiness": False, "post_rollback_backup_required": True,
            })
        return validate_handler_evidence("ROLLBACK_POSTVERIFY", label, evidence)

    def _probe_volume_content(
            self, label: str, inputs: CapabilityInputs, effects: DurableSideEffectRecorder,
    ) -> dict[str, Any]:
        (
            spec, inventory, preflight, stage_evidence, stage_result_sha256, target,
        ) = self._volume_postverify_context(label, inputs)
        domain = spec["domain"]
        probe, probe_receipt = self._complete_effect(
            inputs, effects, "PROBE_UTILITY_CREATE",
            {"target_volume_identity_sha256": target["target_volume_identity_sha256"]},
            {"opcode": "VOLUME_HELPER_PROBE", "domain": domain},
            target["target_volume_identity_sha256"], lambda: self.volume_driver.probe(spec),
        )

        def remove_and_validate() -> dict[str, Any]:
            removed_identity_sha256 = self.volume_driver.remove_utility(spec)
            if probe["file_tree_sha256"] != spec["expected_tree_sha256"] \
                    or probe["entries"] != spec["source_entries"] \
                    or probe["uncompressed_bytes"] != inventory["uncompressed_bytes"] \
                    or probe["metadata_state_sha256"] \
                        != inventory["expected_metadata_state_sha256"] \
                    or probe["metadata_state_sha256"] \
                        != stage_evidence["metadata_state_sha256"]:
                reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_POSTVERIFY_CONTENT_INVALID")
            return {"removed_identity_sha256": removed_identity_sha256}

        removed, _removed_receipt = self._complete_effect(
            inputs, effects, "PROBE_UTILITY_REMOVE",
            {"utility_container": spec["utility_container"],
             "container_id": probe["container_id"]},
            {"opcode": "DOCKER_REMOVE_VERIFIED_HELPER", "domain": domain},
            probe_receipt["receipt_sha256"],
            remove_and_validate,
        )
        if removed["removed_identity_sha256"] == ZERO_SHA256 \
                or preflight["candidate_volume_identity_sha256"] \
                    != spec["candidate_volume_identity_sha256"]:
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_POSTVERIFY_CONTENT_INVALID")
        return self._volume_postverify_evidence(
            label, spec, inventory, stage_evidence, stage_result_sha256, target,
        )

    def _recover_volume_postverify(
            self, label: str, inputs: CapabilityInputs,
            effects: DurableSideEffectRecorder,
    ) -> dict[str, Any]:
        probe_receipt = effects.receipt("PROBE_UTILITY_CREATE")
        remove_receipt = effects.receipt("PROBE_UTILITY_REMOVE")
        if probe_receipt is None or remove_receipt is None:
            raise HandlerOutcomeUnknown(
                "PROBE_INCONCLUSIVE", "PROBE", side_effects_started=True,
                uncertain_action="PROBE",
            )
        try:
            (
                spec, inventory, preflight, stage_evidence, stage_result_sha256, target,
            ) = self._volume_postverify_context(label, inputs)
        except FixedExecutorError as error:
            raise HandlerOutcomeUnknown(
                "TARGET_IDENTITY_DRIFT", "PROBE", side_effects_started=True,
                uncertain_action="PROBE",
            ) from error
        if probe_receipt["before_identity_sha256"] \
                != target["target_volume_identity_sha256"] \
                or remove_receipt["before_identity_sha256"] \
                    != probe_receipt["receipt_sha256"] \
                or preflight["candidate_volume_identity_sha256"] \
                    != spec["candidate_volume_identity_sha256"]:
            raise HandlerOutcomeUnknown(
                "DURABLE_STATE_DIVERGED", "PROBE", side_effects_started=True,
                uncertain_action="PROBE",
            )
        return self._volume_postverify_evidence(
            label, spec, inventory, stage_evidence, stage_result_sha256, target,
        )

    def prepare(
            self, label: str, inputs: CapabilityInputs, _events: list[dict[str, Any]],
    ) -> None:
        allowed = self.INTERNAL_EXECUTION if label in STAGES else self.INTERNAL_POSTVERIFY
        if label not in allowed:
            self._unsupported(label)
        if label in WRITER_EXECUTION_HANDLERS:
            self._writer_context(inputs, run_preflight=True)
        elif label in ACTIVATION_EXECUTION_HANDLERS:
            self._activation_context(inputs, run_preflight=True)
        elif label in PROTECTED_EXECUTION_HANDLERS:
            self._protected_resource_evidence(inputs)
        elif label in POSTGRES_EXECUTION_HANDLERS:
            self._postgres_base_context(inputs, run_preflight=True)
        elif label in VOLUME_EXECUTION_HANDLERS:
            self._prepared_volume(label, inputs, target_present=False)
        elif label in VOLUME_POSTVERIFY_HANDLERS:
            self._volume_postverify_context(label, inputs)
        elif label == "POSTGRESQL_CONTENT":
            self._postgres_content_context(inputs)
        elif label == "MIGRATION_HEAD":
            self._migration_head_context(inputs)
        elif label in SERVICE_POSTVERIFY_HANDLERS:
            self._service_identity_evidence(label, inputs)
        elif label in HEALTH_POSTVERIFY_HANDLERS:
            self._health_evidence(inputs)
        elif label in METADATA_POSTVERIFY_HANDLERS:
            self._metadata_evidence(label, inputs)
        else:
            self._evidence(label, inputs)

    def execute(
            self, label: str, inputs: CapabilityInputs, _events: list[dict[str, Any]],
            _effects: DurableSideEffectRecorder,
    ) -> dict[str, Any]:
        if label not in self.INTERNAL_EXECUTION:
            self._unsupported(label)
        if label in WRITER_EXECUTION_HANDLERS:
            return {"evidence": self._execute_writer(inputs, _effects)}
        if label in ACTIVATION_EXECUTION_HANDLERS:
            return {"evidence": self._execute_activation(inputs, _effects)}
        if label in PROTECTED_EXECUTION_HANDLERS:
            return {"evidence": self._protected_resource_evidence(inputs)}
        if label in POSTGRES_EXECUTION_HANDLERS:
            return {"evidence": self._execute_postgres(inputs, _effects)}
        if label in VOLUME_EXECUTION_HANDLERS:
            return {"evidence": self._execute_volume(label, inputs, _effects)}
        return {"evidence": self._evidence(label, inputs)}

    def probe(
            self, label: str, inputs: CapabilityInputs, _events: list[dict[str, Any]],
            _effects: DurableSideEffectRecorder,
    ) -> dict[str, Any]:
        allowed = self.INTERNAL_EXECUTION if label in STAGES else self.INTERNAL_POSTVERIFY
        if label not in allowed:
            self._unsupported(label)
        if label in VOLUME_POSTVERIFY_HANDLERS:
            if any(
                event.get("event") in {"SIDE_EFFECT_STARTED", "SIDE_EFFECT_RECORDED"}
                for event in _events
            ):
                return {"evidence": self._recover_volume_postverify(
                    label, inputs, _effects,
                )}
            return {"evidence": self._probe_volume_content(label, inputs, _effects)}
        if label == "POSTGRESQL_CONTENT":
            return {"evidence": self._postgres_content_evidence(inputs)}
        if label == "MIGRATION_HEAD":
            return {"evidence": self._migration_head_evidence(inputs)}
        if label in SERVICE_POSTVERIFY_HANDLERS:
            return {"evidence": self._service_identity_evidence(label, inputs)}
        if label in HEALTH_POSTVERIFY_HANDLERS:
            return {"evidence": self._health_evidence(inputs)}
        if label in METADATA_POSTVERIFY_HANDLERS:
            return {"evidence": self._metadata_evidence(label, inputs)}
        if label in WRITER_EXECUTION_HANDLERS:
            return {"evidence": self._recover_writer(inputs, _effects)}
        if label in ACTIVATION_EXECUTION_HANDLERS:
            return {"evidence": self._recover_activation(inputs, _effects)}
        if label in PROTECTED_EXECUTION_HANDLERS:
            return {"evidence": self._protected_resource_evidence(inputs)}
        if label in POSTGRES_EXECUTION_HANDLERS:
            return {"evidence": self._recover_postgres_execution(inputs, _effects)}
        if label in VOLUME_EXECUTION_HANDLERS:
            return {"evidence": self._recover_volume_execution(label, inputs, _effects)}
        return {"evidence": self._evidence(label, inputs)}

    def observe(self, inputs: CapabilityInputs) -> dict[str, Any]:
        if self.operation_driver is None:
            reject("ROLLBACK_FIXED_EXECUTOR_UAT_CAPABILITY_UNAVAILABLE")
        if inputs.request["action"] in {"PREFLIGHT", "RECHECK"}:
            return self.operation_driver.gate(inputs)
        if inputs.request["action"] == "PROBE":
            return self.operation_driver.probe(inputs, self.filesystem_root)
        reject("ROLLBACK_FIXED_EXECUTOR_DISPATCH_INVALID")

    def contain(
            self, inputs: CapabilityInputs, filesystem_root: str,
    ) -> dict[str, Any]:
        if self.operation_driver is None or filesystem_root != self.filesystem_root:
            reject("ROLLBACK_FIXED_EXECUTOR_UAT_CAPABILITY_UNAVAILABLE")
        return self.operation_driver.contain(inputs, filesystem_root)


class StructuredCapabilityBackend:
    """Maps all fixed labels to a runtime implementation and closes result construction."""

    def __init__(self, runtime: Any, *, clock: Any = utc_now):
        self.runtime = runtime
        self.clock = clock

    @staticmethod
    def bind_terminal_evidence(
            effects: DurableSideEffectRecorder, evidence: dict[str, Any],
    ) -> None:
        effects.validate_terminal_evidence(evidence)

    def prepare(
            self, request: dict[str, Any], manifest: dict[str, Any],
            events: list[dict[str, Any]],
    ) -> None:
        self.runtime.prepare(request["label"], CapabilityInputs(request, manifest), events)

    def execute(
            self, request: dict[str, Any], manifest: dict[str, Any],
            events: list[dict[str, Any]], effects: DurableSideEffectRecorder,
    ) -> dict[str, Any]:
        if request["operation"] != "ROLLBACK_EXECUTION":
            reject("ROLLBACK_FIXED_EXECUTOR_DISPATCH_INVALID")
        started = self.clock()
        outcome = self.runtime.execute(
            request["label"], CapabilityInputs(request, manifest), events, effects,
        )
        if not isinstance(outcome, dict) or set(outcome) != {"evidence"} \
                or not isinstance(outcome["evidence"], dict):
            reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_RESULT_INVALID")
        evidence = validate_handler_evidence(
            request["operation"], request["label"], outcome["evidence"],
        )
        self.bind_terminal_evidence(effects, evidence)
        record = create_handler_result_record(
            request, evidence, effects.assert_closed(), started, self.clock(),
        )
        return {"record": record}

    def probe(
            self, request: dict[str, Any], manifest: dict[str, Any],
            events: list[dict[str, Any]], effects: DurableSideEffectRecorder,
    ) -> dict[str, Any]:
        started = self.clock()
        outcome = self.runtime.probe(
            request["label"], CapabilityInputs(request, manifest), events, effects,
        )
        if not isinstance(outcome, dict) or set(outcome) != {"evidence"} \
                or not isinstance(outcome["evidence"], dict):
            reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_RESULT_INVALID")
        evidence = validate_handler_evidence(
            request["operation"], request["label"], outcome["evidence"],
        )
        self.bind_terminal_evidence(effects, evidence)
        record = create_handler_result_record(
            request, evidence, effects.assert_closed(), started, self.clock(),
        )
        return {"record": record}

    def observe(self, request: dict[str, Any], manifest: dict[str, Any]) -> dict[str, Any]:
        return self.runtime.observe(CapabilityInputs(request, manifest))

    def contain(
            self, request: dict[str, Any], manifest: dict[str, Any], filesystem_root: str,
    ) -> dict[str, Any]:
        return self.runtime.contain(CapabilityInputs(request, manifest), filesystem_root)


class ActionDeadlineBudget:
    """Monotonic tool budget derived once from the validated UTC action deadline."""

    def __init__(
            self, action_deadline: str, *, wall_clock: Any = time.time,
            monotonic_clock: Any = time.monotonic,
    ):
        if not isinstance(action_deadline, str) or ISO_UTC.fullmatch(action_deadline) is None:
            reject("ROLLBACK_FIXED_EXECUTOR_ACTION_DEADLINE_INVALID")
        try:
            deadline = datetime.strptime(
                action_deadline, "%Y-%m-%dT%H:%M:%S.%fZ",
            ).replace(tzinfo=timezone.utc).timestamp()
            wall_now = float(wall_clock())
            monotonic_now = float(monotonic_clock())
        except (TypeError, ValueError, OverflowError, OSError):
            reject("ROLLBACK_FIXED_EXECUTOR_ACTION_DEADLINE_INVALID")
        if not all(value == value and abs(value) != float("inf") for value in (
            deadline, wall_now, monotonic_now,
        )):
            reject("ROLLBACK_FIXED_EXECUTOR_ACTION_DEADLINE_INVALID")
        self._deadline = monotonic_now + (deadline - wall_now)
        self._clock = monotonic_clock

    def clip(self, requested_seconds: float) -> float:
        if isinstance(requested_seconds, bool) or not isinstance(requested_seconds, (int, float)) \
                or not 0.1 <= requested_seconds <= 1800:
            reject("ROLLBACK_FIXED_EXECUTOR_TOOL_TIMEOUT_INVALID")
        try:
            remaining = self._deadline - float(self._clock()) \
                - ACTION_DEADLINE_RESPONSE_RESERVE_SECONDS
        except (TypeError, ValueError, OverflowError):
            reject("ROLLBACK_FIXED_EXECUTOR_ACTION_DEADLINE_INVALID")
        if remaining < 0.1:
            raise HandlerOutcomeUnknown(
                "ACTION_DEADLINE_EXHAUSTED", "BEFORE_SIDE_EFFECT",
                side_effects_started=False,
            )
        return min(float(requested_seconds), remaining)


class ClosedDockerRunner:
    """Opcode-only no-shell invocation through the verified Docker descriptor."""

    CONTAINER_INSPECT_FORMAT = (
        '[{{json .Id}},{{json .Name}},{{json .Image}},{{json .Config.Image}},'
        '{{json .Config.Labels}},{{json .State.Status}},{{json (index .State "Health")}},'
        '{{json .RestartCount}},{{json .State.OOMKilled}},{{json .Mounts}},'
        '{{json .NetworkSettings.Networks}},{{json .Config.User}},'
        '{{json .HostConfig.ReadonlyRootfs}},{{json .HostConfig.CapDrop}},'
        '{{json .HostConfig.CapAdd}},{{json .HostConfig.SecurityOpt}},'
        '{{json .HostConfig.NetworkMode}}]'
    )
    IMAGE_INSPECT_FORMAT = (
        '[{{json .Id}},{{json .Os}},{{json .Architecture}},{{json .RepoDigests}},'
        '{{json (index . "Descriptor")}},{{json (index .Config "Cmd")}},'
        '{{json (index .Config "Entrypoint")}},{{json (index .Config "WorkingDir")}},'
        '{{json (index .Config "StopSignal")}}]'
    )
    VOLUME_HELPER_IMAGE_INSPECT_FORMAT = (
        '[{{json .Id}},{{json .Os}},{{json .Architecture}},{{json .RepoDigests}},'
        '{{json .Config.Labels}},{{json .Config.User}},{{json .Config.Entrypoint}},'
        '{{json .Config.Cmd}},{{json .Config.WorkingDir}},{{json .RootFS.Type}},'
        '{{json .RootFS.Layers}}]'
    )
    VOLUME_UTILITY_INSPECT_FORMAT = (
        '[{{json .Id}},{{json .Name}},{{json .Image}},{{json .Config.Image}},'
        '{{json .Config.Labels}},{{json .State.Status}},{{json .State.ExitCode}},'
        '{{json (index .State "Health")}},{{json .RestartCount}},{{json .State.OOMKilled}},'
        '{{json .Mounts}},{{json .Config.User}},{{json .Config.Entrypoint}},'
        '{{json .Config.Cmd}},{{json .Config.WorkingDir}},{{json .Config.OpenStdin}},'
        '{{json .HostConfig.ReadonlyRootfs}},{{json .HostConfig.CapDrop}},'
        '{{json .HostConfig.CapAdd}},{{json .HostConfig.SecurityOpt}},'
        '{{json .HostConfig.NetworkMode}},{{json .HostConfig.PidsLimit}},'
        '{{json .HostConfig.Memory}},{{json .HostConfig.MemorySwap}},'
        '{{json .HostConfig.NanoCpus}},{{json .HostConfig.RestartPolicy}},'
        '{{json .HostConfig.AutoRemove}},{{json .HostConfig.Privileged}},'
        '{{json .HostConfig.Devices}}]'
    )
    RESOURCE_INSPECT_FORMAT = "{{json .}}"
    READINESS_NODE_SOURCE = (
        "fetch('http://127.0.0.1:3000/api/health',{redirect:'error'})"
        ".then(async response=>{const text=await response.text();"
        "if(!response.ok)process.exit(41);process.stdout.write(text)})"
        ".catch(()=>process.exit(42))"
    )
    RELEASE_IDENTITY_NODE_SOURCE = (
        "const fs=require('node:fs');"
        "process.stdout.write(fs.readFileSync("
        "'/run/chenyida-erp-release/release-identity.json','utf8'))"
    )
    PROTECTED_VOLUME_KEYS = {
        "caddy_config", "caddy_data", "erp_attachments", "erp_backup_status",
        "erp_postgres", "erp_postgres_tablespaces", "erp_uploads",
    }

    def __init__(
            self, docker_fd: int, plan: dict[str, Any], *, action_deadline: str,
            wall_clock: Any = time.time, monotonic_clock: Any = time.monotonic,
            execution_observer: Any | None = None,
    ):
        if not isinstance(docker_fd, int) or docker_fd < 3:
            reject("ROLLBACK_FIXED_EXECUTOR_DOCKER_FD_INVALID")
        if execution_observer is not None and not callable(execution_observer):
            reject("ROLLBACK_FIXED_EXECUTOR_EXECUTION_OBSERVER_INVALID")
        self.docker_fd = docker_fd
        self.plan = plan
        # The observer is disabled in normal operation.  The isolated TASK70
        # harness opts in so it can bind a completed Docker invocation to the
        # exact stdin and output bytes without changing command semantics.
        self.execution_observer = execution_observer
        self.volume_helper = validate_volume_helper_plan(
            plan.get("helpers", {}).get("volume_restore"),
        )
        self.deadline_budget = ActionDeadlineBudget(
            action_deadline, wall_clock=wall_clock, monotonic_clock=monotonic_clock,
        )
        self.protected_container_ids = {
            plan["candidate"]["services"][service]["container_id"]
            for service in ("caddy", "postgres")
        }
        self.candidate_writer_ids = {
            plan["candidate"]["services"][service]["container_id"]
            for service in ("web", "worker")
        }
        self.pending_container_ids: set[str] = set()
        self.admitted_writer_ids: set[str] = set()
        self.pending_utility_ids: dict[str, str] = {}
        self.admitted_utility_ids: dict[str, str] = {}
        self.started_utility_ids: dict[str, str] = {}
        self.exited_utility_ids: dict[str, str] = {}
        self.removed_utility_ids: dict[str, str] = {}
        self.pending_utility_specs: dict[str, dict[str, Any]] = {}
        self.admitted_utility_specs: dict[str, dict[str, Any]] = {}
        self.volume_helper_admission_sha256: str | None = None
        self.allowed_container_ids = self.protected_container_ids | self.candidate_writer_ids
        self.allowed_utility_names = {
            item["utility_container"] for item in plan["targets"]["volumes"].values()
        }
        self.candidate_volume_names = {
            item["name"] for item in plan["candidate"]["volumes"].values()
        }
        project = plan["deployment"]["compose_project"]
        self.protected_volume_names = {
            f"{project}_{logical}" for logical in self.PROTECTED_VOLUME_KEYS
        }
        if not self.candidate_volume_names.issubset(self.protected_volume_names):
            reject("ROLLBACK_FIXED_EXECUTOR_DOCKER_PLAN_INVALID")
        self.derived_volume_names = {
            item["target"] for item in plan["targets"]["volumes"].values()
        }
        self.allowed_volume_names = self.protected_volume_names | self.derived_volume_names
        self.allowed_image_references = {
            item["image_reference"] for item in plan["candidate"]["services"].values()
        } | {
            plan["predecessor"]["web_image"], plan["predecessor"]["worker_image"],
            self.volume_helper["image_reference"],
        }
        self.allowed_network_names = {f"{project}_backend", f"{project}_edge"}
        self._authorized_invocation: tuple[tuple[str, ...], tuple[tuple[str, str], ...]] | None = None

    @staticmethod
    def _strict_values(values: Any, allowed: set[str], code: str) -> list[str]:
        if not isinstance(values, (list, tuple, set)) or not values:
            reject(code)
        result = sorted(values)
        if len(result) != len(set(result)) or any(
            not isinstance(item, str) or item not in allowed for item in result
        ):
            reject(code)
        return result

    def _call(
            self, arguments: list[str], *, stdin_fd: int | None = None,
            environment: dict[str, str] | None = None, timeout_seconds: float = 60,
            maximum_output: int = MAX_JSON_BYTES, effectful: bool = False,
            observe_execution: bool = False,
    ) -> bytes:
        selected_environment = environment or {}
        if not isinstance(observe_execution, bool):
            reject("ROLLBACK_FIXED_EXECUTOR_EXECUTION_OBSERVER_INVALID")
        if self._authorized_invocation is not None:
            reject("ROLLBACK_FIXED_EXECUTOR_DOCKER_REENTRANT_INVALID")
        self._authorized_invocation = (
            tuple(arguments), tuple(sorted(selected_environment.items())),
        )
        try:
            bounded_timeout = self.deadline_budget.clip(timeout_seconds)
            return self._run_generated(
                arguments, stdin_fd=stdin_fd, environment=selected_environment,
                timeout_seconds=bounded_timeout, maximum_output=maximum_output,
                side_effects_started=effectful,
                observe_execution=observe_execution,
            )
        finally:
            self._authorized_invocation = None

    @staticmethod
    def _sealed_input(raw: bytes, name: str, maximum_bytes: int) -> int:
        if not isinstance(raw, bytes) or not raw or len(raw) > maximum_bytes \
                or not re.fullmatch(r"[a-z0-9-]{1,48}", name):
            reject("ROLLBACK_FIXED_EXECUTOR_SEALED_INPUT_INVALID")
        required = (
            "MFD_CLOEXEC", "MFD_ALLOW_SEALING", "F_ADD_SEALS", "F_GET_SEALS",
            "F_SEAL_SEAL", "F_SEAL_SHRINK", "F_SEAL_GROW", "F_SEAL_WRITE",
        )
        if not hasattr(os, "memfd_create") or any(
            not hasattr(os if item.startswith("MFD_") else fcntl, item)
            for item in required
        ):
            reject("ROLLBACK_FIXED_EXECUTOR_SEALED_INPUT_INVALID")
        descriptor = -1
        try:
            descriptor = os.memfd_create(name, os.MFD_CLOEXEC | os.MFD_ALLOW_SEALING)
            offset = 0
            while offset < len(raw):
                written = os.write(descriptor, raw[offset:])
                if written <= 0:
                    raise OSError("short write")
                offset += written
            os.fchmod(descriptor, 0o400)
            os.lseek(descriptor, 0, os.SEEK_SET)
            seals = (
                fcntl.F_SEAL_SEAL | fcntl.F_SEAL_SHRINK
                | fcntl.F_SEAL_GROW | fcntl.F_SEAL_WRITE
            )
            fcntl.fcntl(descriptor, fcntl.F_ADD_SEALS, seals)
            if fcntl.fcntl(descriptor, fcntl.F_GET_SEALS) != seals \
                    or sha256_fd(descriptor) != hashlib.sha256(raw).hexdigest():
                raise OSError("seal mismatch")
            return descriptor
        except OSError:
            if descriptor >= 0:
                os.close(descriptor)
            reject("ROLLBACK_FIXED_EXECUTOR_SEALED_INPUT_INVALID")
        raise AssertionError("unreachable")

    def inspect_containers(self, container_ids: Any) -> bytes:
        allowed = (
            self.allowed_container_ids | self.pending_container_ids
            | self.admitted_writer_ids
        )
        targets = self._strict_values(
            container_ids, allowed, "ROLLBACK_FIXED_EXECUTOR_CONTAINER_TARGET_INVALID",
        )
        return self._call([
            "inspect", "--type", "container", "--format", self.CONTAINER_INSPECT_FORMAT,
            "--", *targets,
        ], maximum_output=1024 * 1024)

    def inspect_image(self, reference: str) -> bytes:
        if reference not in self.allowed_image_references:
            reject("ROLLBACK_FIXED_EXECUTOR_IMAGE_TARGET_INVALID")
        return self._call([
            "image", "inspect", "--format", self.IMAGE_INSPECT_FORMAT, "--", reference,
        ], maximum_output=512 * 1024)

    def inspect_web_readiness(self, container_id: str) -> bytes:
        if container_id not in self.admitted_writer_ids:
            reject("ROLLBACK_FIXED_EXECUTOR_HEALTH_CONTAINER_INVALID")
        return self._call([
            "exec", "--", container_id, "/usr/local/bin/node", "-e",
            self.READINESS_NODE_SOURCE,
        ], timeout_seconds=10, maximum_output=1024 * 1024)

    def read_mounted_release_identity(self, container_id: str) -> bytes:
        if container_id not in self.admitted_writer_ids:
            reject("ROLLBACK_FIXED_EXECUTOR_HEALTH_CONTAINER_INVALID")
        return self._call([
            "exec", "--", container_id, "/usr/local/bin/node", "-e",
            self.RELEASE_IDENTITY_NODE_SOURCE,
        ], timeout_seconds=10, maximum_output=64 * 1024)

    def inspect_volume_helper_image(self) -> bytes:
        return self._call([
            "image", "inspect", "--format", self.VOLUME_HELPER_IMAGE_INSPECT_FORMAT,
            "--", self.volume_helper["image_reference"],
        ], maximum_output=512 * 1024)

    def admit_volume_helper_image(self, output: bytes) -> str:
        code = "ROLLBACK_FIXED_EXECUTOR_VOLUME_HELPER_IMAGE_INVALID"
        if not isinstance(output, bytes) or not 2 <= len(output) <= 512 * 1024:
            reject(code)
        try:
            value = json.loads(output.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            reject(code)
        if not isinstance(value, list) or len(value) != 11:
            reject(code)
        (
            image_id, operating_system, architecture, repo_digests, labels, user,
            entrypoint, command, working_directory, rootfs_type, rootfs_layers,
        ) = value
        helper = self.volume_helper
        expected_labels = {
            "org.opencontainers.image.version": helper["application_version"],
            "org.opencontainers.image.revision": helper["git_commit"],
            "io.chenyida.erp.git-tree": helper["git_tree"],
            "io.chenyida.erp.image-role": helper["image_role"],
            "io.chenyida.erp.volume-helper.protocol": helper["protocol"],
            "io.chenyida.erp.volume-helper.toolchain-contract-sha256":
                helper["contract_sha256"],
        }
        if image_id != helper["image_config_digest"] or operating_system != "linux" \
                or architecture != "amd64" or not isinstance(repo_digests, list) \
                or repo_digests.count(helper["image_reference"]) != 1 \
                or any(not isinstance(item, str) or IMAGE_REFERENCE.fullmatch(item) is None
                       for item in repo_digests) \
                or not isinstance(labels, dict) \
                or any(labels.get(key) != expected for key, expected in expected_labels.items()) \
                or user != "0:0" or entrypoint != [VOLUME_HELPER_ENTRYPOINT] \
                or command != ["unsupported"] or working_directory != "/" \
                or rootfs_type != "layers" or not isinstance(rootfs_layers, list) \
                or not rootfs_layers or any(
                    not isinstance(item, str) or IMAGE_DIGEST.fullmatch(item) is None
                    for item in rootfs_layers
                ):
            reject(code)
        body = {
            "image_reference": helper["image_reference"],
            "image_config_digest": image_id,
            "platform": f"{operating_system}/{architecture}",
            "labels": {key: labels[key] for key in sorted(expected_labels)},
            "entrypoint": entrypoint, "command": command,
            "working_directory": working_directory,
            "rootfs_layers_sha256": digest_value(rootfs_layers),
            "build_provenance_sha256": helper["build_provenance_sha256"],
            "sbom_evidence_sha256": helper["sbom_evidence_sha256"],
            "security_evidence_sha256": helper["security_evidence_sha256"],
            "supervisor_bundle_sha256": helper["supervisor_bundle_sha256"],
        }
        self.volume_helper_admission_sha256 = digest_value(body)
        return self.volume_helper_admission_sha256

    def inspect_volumes(self, names: Any) -> bytes:
        targets = self._strict_values(
            names, self.allowed_volume_names,
            "ROLLBACK_FIXED_EXECUTOR_VOLUME_TARGET_INVALID",
        )
        return self._call([
            "volume", "inspect", "--format", self.RESOURCE_INSPECT_FORMAT, "--", *targets,
        ], maximum_output=1024 * 1024)

    def discover_volume(self, name: str) -> bytes:
        if name not in self.allowed_volume_names:
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_TARGET_INVALID")
        return self._call([
            "volume", "ls", "--quiet", "--filter", f"name=^{name}$",
        ], maximum_output=64 * 1024)

    @staticmethod
    def parse_volume_discovery(output: bytes, expected_name: str) -> bool:
        code = "ROLLBACK_FIXED_EXECUTOR_VOLUME_DISCOVERY_INVALID"
        if not isinstance(output, bytes) or len(output) > 64 * 1024 \
                or not IDENTIFIER.fullmatch(expected_name or ""):
            reject(code)
        try:
            names = [item for item in output.decode("utf-8").splitlines() if item]
        except UnicodeDecodeError:
            reject(code)
        if names not in ([], [expected_name]):
            reject(code)
        return bool(names)

    def inspect_networks(self) -> bytes:
        targets = sorted(self.allowed_network_names)
        return self._call([
            "network", "inspect", "--format", self.RESOURCE_INSPECT_FORMAT, "--", *targets,
        ], maximum_output=1024 * 1024)

    def discover_project_containers(self) -> bytes:
        project = self.plan["deployment"]["compose_project"]
        return self._call([
            "ps", "--all", "--quiet", "--no-trunc", "--filter",
            f"label=com.docker.compose.project={project}",
        ], maximum_output=256 * 1024)

    def register_discovered_containers(self, container_ids: Any) -> None:
        if not isinstance(container_ids, (list, tuple, set)) or len(container_ids) > 64:
            reject("ROLLBACK_FIXED_EXECUTOR_CONTAINER_DISCOVERY_INVALID")
        values = set(container_ids)
        if len(values) != len(container_ids) or any(
            not isinstance(item, str) or CONTAINER_ID.fullmatch(item) is None for item in values
        ):
            reject("ROLLBACK_FIXED_EXECUTOR_CONTAINER_DISCOVERY_INVALID")
        self.pending_container_ids |= values - self.allowed_container_ids

    def admit_predecessor_writers(self, container_ids: Any) -> None:
        values = set(self._strict_values(
            container_ids, self.pending_container_ids,
            "ROLLBACK_FIXED_EXECUTOR_WRITER_ADMISSION_INVALID",
        ))
        self.admitted_writer_ids |= values
        self.pending_container_ids -= values

    def admit_runtime_writers(self, container_ids: Any) -> None:
        if not isinstance(container_ids, (list, tuple, set)) or not container_ids:
            reject("ROLLBACK_FIXED_EXECUTOR_WRITER_ADMISSION_INVALID")
        values = set(container_ids)
        if len(values) != len(container_ids) or any(
                not isinstance(item, str) or CONTAINER_ID.fullmatch(item) is None
                for item in values
        ) or not values.issubset(self.candidate_writer_ids | self.pending_container_ids):
            reject("ROLLBACK_FIXED_EXECUTOR_WRITER_ADMISSION_INVALID")
        admitted = values - self.candidate_writer_ids
        self.admitted_writer_ids |= admitted
        self.pending_container_ids -= admitted

    def stop_writers(self, container_ids: Any) -> bytes:
        targets = self._strict_values(
            container_ids, self.candidate_writer_ids | self.admitted_writer_ids,
            "ROLLBACK_FIXED_EXECUTOR_WRITER_TARGET_INVALID",
        )
        return self._call(
            ["stop", "--time", "30", "--", *targets], timeout_seconds=60,
            maximum_output=256 * 1024, effectful=True,
        )

    def postgres_runtime_observation(self) -> bytes:
        active = _pg_literal(self.plan["targets"]["database"]["active"])
        staging = _pg_literal(self.plan["targets"]["database"]["staging"])
        quarantine = _pg_literal(
            self.plan["targets"]["database"]["candidate_quarantine"],
        )
        sql = f"""BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_catalog.json_build_object(
  'system_identifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
  'databases',coalesce((SELECT pg_catalog.json_agg(row_value ORDER BY row_value->>'name')
    FROM (
      SELECT pg_catalog.json_build_object(
        'name',d.datname,'oid',d.oid::text,
        'marker',pg_catalog.shobj_description(d.oid,'pg_database'),
        'allow_connections',d.datallowconn,'connection_limit',d.datconnlimit,
        'default_transaction_read_only',EXISTS(
          SELECT 1 FROM pg_catalog.pg_db_role_setting s
          WHERE s.setdatabase=d.oid AND s.setrole=0
            AND 'default_transaction_read_only=on'=ANY(s.setconfig)),
        'writer_sessions',(SELECT count(*) FROM pg_catalog.pg_stat_activity a
          WHERE a.datid=d.oid AND a.pid<>pg_catalog.pg_backend_pid()
            AND a.usename IN ('chenyida_erp_web','chenyida_erp_worker')
            AND a.state IS DISTINCT FROM 'idle'),
        'prepared_xacts',(SELECT count(*) FROM pg_catalog.pg_prepared_xacts x
          WHERE x.database=d.datname)
      ) AS row_value
      FROM pg_catalog.pg_database d
      WHERE d.datname IN ({active},{staging},{quarantine})
    ) rows_value),'[]'::json)
)::text;
COMMIT;
""".encode("utf-8")
        return self._postgres_psql_generated(
            "postgres", "runtimeobserve", sql, effectful=False,
        )

    def postgres_runtime_seal(self, database: dict[str, Any]) -> bytes:
        code = "ROLLBACK_FIXED_EXECUTOR_RUNTIME_CONTAINMENT_INVALID"
        database = exact(database, {
            "name", "system_identifier", "oid", "marker", "allow_connections",
            "writer_sessions", "sealed",
        }, code)
        expected = self.plan["deployment"]["database"]
        if database["name"] != expected["name"] \
                or database["system_identifier"] != expected["system_identifier"] \
                or database["marker"] != expected["marker"] \
                or OID.fullmatch(database.get("oid") or "") is None \
                or not isinstance(database.get("allow_connections"), bool) \
                or not isinstance(database.get("writer_sessions"), int) \
                or not isinstance(database.get("sealed"), bool):
            reject(code)
        active = _pg_identifier(database["name"])
        active_name = _pg_literal(database["name"])
        active_oid = _pg_literal(database["oid"])
        marker = _pg_literal(database["marker"])
        system_identifier = _pg_literal(database["system_identifier"])
        lock_name = _pg_literal(
            f"chenyida-erp-uat-rollback-containment:{self.plan['runtime_plan_sha256']}",
        )
        sql = f"""BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended({lock_name},0));
DO $cyd$
BEGIN
  IF (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> {system_identifier}
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_database d
       WHERE d.datname={active_name} AND d.oid::text={active_oid}
         AND pg_catalog.shobj_description(d.oid,'pg_database')={marker}
         AND ((d.datallowconn=true AND d.datconnlimit=64 AND NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_db_role_setting s
           WHERE s.setdatabase=d.oid AND s.setrole=0
             AND 'default_transaction_read_only=on'=ANY(s.setconfig)))
          OR (d.datallowconn=false AND d.datconnlimit=0 AND EXISTS (
           SELECT 1 FROM pg_catalog.pg_db_role_setting s
           WHERE s.setdatabase=d.oid AND s.setrole=0
             AND 'default_transaction_read_only=on'=ANY(s.setconfig))))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_prepared_xacts WHERE database={active_name})
  THEN RAISE EXCEPTION 'rollback containment database mismatch'; END IF;
END
$cyd$;
ALTER DATABASE {active} SET default_transaction_read_only TO on;
ALTER DATABASE {active} ALLOW_CONNECTIONS false;
ALTER DATABASE {active} CONNECTION LIMIT 0;
SELECT pg_catalog.pg_terminate_backend(pid)
FROM pg_catalog.pg_stat_activity
WHERE datname={active_name} AND pid<>pg_catalog.pg_backend_pid();
COMMIT;
""".encode("utf-8")
        return self._postgres_psql_generated(
            "postgres", "runtimeseal", sql, effectful=True,
        )

    def derived_volume_labels(self, domain: str, binding: dict[str, Any]) -> dict[str, str]:
        if domain not in {"uploads", "attachments", "backup_status"}:
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_DOMAIN_INVALID")
        binding = exact(binding, {
            "source_artifact_sha256", "source_reconciliation_sha256",
            "expected_tree_sha256", "marker_sha256",
        }, "ROLLBACK_FIXED_EXECUTOR_VOLUME_BINDING_INVALID")
        _evidence_strings(binding, tuple(binding), SHA256,
                          "ROLLBACK_FIXED_EXECUTOR_VOLUME_BINDING_INVALID")
        return {
            "chenyida.erp.uat-rollback-operation": self.plan["rollback_operation_id"],
            "chenyida.erp.uat-rollback-runtime-plan": self.plan["runtime_plan_sha256"],
            "chenyida.erp.uat-rollback-domain": domain,
            "chenyida.erp.uat-rollback-source": binding["source_artifact_sha256"],
            "chenyida.erp.uat-rollback-reconciliation": binding["source_reconciliation_sha256"],
            "chenyida.erp.uat-rollback-tree": binding["expected_tree_sha256"],
            "chenyida.erp.uat-rollback-marker": binding["marker_sha256"],
        }

    def create_derived_volume(self, domain: str, binding: dict[str, Any]) -> bytes:
        target = self.plan["targets"]["volumes"][domain]["target"]
        labels = self.derived_volume_labels(domain, binding)
        arguments = ["volume", "create", "--driver", "local"]
        for key, value in sorted(labels.items()):
            arguments.extend(["--label", f"{key}={value}"])
        arguments.extend(["--", target])
        return self._call(
            arguments, timeout_seconds=60, maximum_output=256 * 1024, effectful=True,
        )

    @staticmethod
    def _normalize_capabilities(value: Any) -> list[str] | None:
        if value is None:
            return []
        if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
            return ["__INVALID__"]
        return sorted(item.removeprefix("CAP_") for item in value)

    def _volume_helper_spec(
            self, domain: str, opcode: str, arguments: list[str],
    ) -> dict[str, Any]:
        code = "ROLLBACK_FIXED_EXECUTOR_VOLUME_HELPER_OPCODE_INVALID"
        if domain not in {"uploads", "attachments", "backup_status"} \
                or not isinstance(arguments, list) \
                or any(not isinstance(item, str) or not item for item in arguments):
            reject(code)
        if opcode == "capacity" and not arguments:
            generation, read_only, stdin_required, caps = "candidate", True, False, []
        elif opcode == "restore" and not arguments:
            generation, read_only, stdin_required, caps = "target", False, True, []
        elif opcode == f"reconcile-{domain.replace('_', '-')}" and not arguments \
                and domain in {"uploads", "attachments"}:
            generation, read_only, stdin_required, caps = \
                "target", False, False, ["CHOWN", "FOWNER"]
        elif opcode == "reconcile-backup-status" and domain == "backup_status" \
                and len(arguments) == 1 \
                and re.fullmatch(r"(?:[1-9]|[1-9][0-9]{1,9})", arguments[0]) \
                and int(arguments[0]) <= 2**31 - 1:
            generation, read_only, stdin_required, caps = \
                "target", False, False, ["CHOWN", "FOWNER"]
        elif opcode == "probe" and (
                domain in {"uploads", "attachments"} and arguments == [domain]
                or domain == "backup_status" and len(arguments) == 2
                and arguments[0] == domain
                and re.fullmatch(r"(?:[1-9]|[1-9][0-9]{1,9})", arguments[1])
                and int(arguments[1]) <= 2**31 - 1
        ):
            generation, read_only, stdin_required, caps = (
                "target", True, False,
                ["DAC_READ_SEARCH"] if domain in {"uploads", "attachments"} else [],
            )
        else:
            reject(code)
        volume_name = self.plan["candidate"]["volumes"][domain]["name"] \
            if generation == "candidate" \
            else self.plan["targets"]["volumes"][domain]["target"]
        return {
            "domain": domain, "opcode": opcode, "arguments": list(arguments),
            "volume_generation": generation, "volume_name": volume_name,
            "read_only": read_only, "stdin_required": stdin_required,
            "cap_add": caps,
        }

    def expect_volume_utility(
            self, domain: str, opcode: str, arguments: list[str] | None = None,
    ) -> dict[str, Any]:
        if self.volume_helper_admission_sha256 is None:
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_HELPER_IMAGE_NOT_ADMITTED")
        if domain in self.pending_utility_ids or domain in self.admitted_utility_ids \
                or domain in self.started_utility_ids or domain in self.exited_utility_ids:
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_UTILITY_STATE_INVALID")
        spec = self._volume_helper_spec(domain, opcode, arguments or [])
        prior = self.pending_utility_specs.get(domain)
        if prior is not None and prior != spec:
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_UTILITY_STATE_INVALID")
        self.pending_utility_specs[domain] = spec
        return spec

    def create_volume_utility(
            self, domain: str, opcode: str, arguments: list[str] | None = None,
    ) -> str:
        spec = self.expect_volume_utility(domain, opcode, arguments)
        utility = self.plan["targets"]["volumes"][domain]["utility_container"]
        labels = {
            "chenyida.erp.uat-rollback-domain": domain,
            "chenyida.erp.uat-rollback-helper-config":
                self.volume_helper["image_config_digest"],
            "chenyida.erp.uat-rollback-helper-opcode": opcode,
            "chenyida.erp.uat-rollback-operation": self.plan["rollback_operation_id"],
            "chenyida.erp.uat-rollback-runtime-plan": self.plan["runtime_plan_sha256"],
            "chenyida.erp.uat-rollback-volume-generation": spec["volume_generation"],
            "chenyida.erp.uat-rollback-volume-name": spec["volume_name"],
        }
        mount = f"type=volume,src={spec['volume_name']},dst=/target,volume-nocopy"
        if spec["read_only"]:
            mount += ",readonly"
        command = ["create"]
        if spec["stdin_required"]:
            command.append("--interactive")
        command.extend(["--name", utility])
        for key, value in sorted(labels.items()):
            command.extend(["--label", f"{key}={value}"])
        command.extend([
            "--network", "none", "--pull", "never", "--read-only",
            "--cap-drop", "ALL",
        ])
        for capability in spec["cap_add"]:
            command.extend(["--cap-add", capability])
        command.extend([
            "--security-opt", "no-new-privileges=true", "--pids-limit", "64",
            "--memory", "268435456", "--memory-swap", "268435456",
            "--cpus", "1", "--user", "0:0", "--mount", mount, "--",
            self.volume_helper["image_reference"], opcode, *spec["arguments"],
        ])
        output = self._call(
            command, timeout_seconds=60, maximum_output=64 * 1024, effectful=True,
        )
        try:
            identifier = output.decode("ascii")
        except UnicodeDecodeError:
            identifier = ""
        if not identifier.endswith("\n") or identifier.count("\n") != 1 \
                or CONTAINER_ID.fullmatch(identifier[:-1]) is None:
            raise HandlerOutcomeUnknown(
                "SIDE_EFFECT_OUTCOME_UNKNOWN", "AFTER_SIDE_EFFECT",
                side_effects_started=True,
            )
        identifier = identifier[:-1]
        self.pending_utility_ids[domain] = identifier
        return identifier

    def start_volume_utility(
            self, domain: str, *, archive_fd: int | None = None,
            expected_sha256: str | None = None,
    ) -> bytes:
        identifier = self.admitted_utility_ids.get(domain)
        spec = self.admitted_utility_specs.get(domain)
        if identifier is None or spec is None or domain in self.started_utility_ids:
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_UTILITY_NOT_ADMITTED")
        before = None
        if spec["stdin_required"]:
            if not isinstance(archive_fd, int) or archive_fd < 3 \
                    or not SHA256.fullmatch(expected_sha256 or ""):
                reject("ROLLBACK_FIXED_EXECUTOR_DOCKER_STDIN_INVALID")
            try:
                before = os.fstat(archive_fd)
                if not stat.S_ISREG(before.st_mode) \
                        or sha256_fd(archive_fd) != expected_sha256:
                    reject("ROLLBACK_FIXED_EXECUTOR_DOCKER_STDIN_INVALID")
                os.lseek(archive_fd, 0, os.SEEK_SET)
            except OSError:
                reject("ROLLBACK_FIXED_EXECUTOR_DOCKER_STDIN_INVALID")
        elif archive_fd is not None or expected_sha256 is not None:
            reject("ROLLBACK_FIXED_EXECUTOR_DOCKER_STDIN_INVALID")
        command = ["start", "--attach"]
        if spec["stdin_required"]:
            command.append("--interactive")
        command.extend(["--", identifier])
        output = self._call(
            command, stdin_fd=archive_fd, timeout_seconds=1800
            if spec["opcode"] == "restore" else 300,
            maximum_output=1024 * 1024, effectful=True,
        )
        self.started_utility_ids[domain] = identifier
        if before is not None:
            try:
                after = os.fstat(archive_fd)
            except OSError:
                raise HandlerOutcomeUnknown(
                    "SOURCE_IDENTITY_DRIFT", "AFTER_SIDE_EFFECT", side_effects_started=True,
                ) from None
            identity = lambda item: (
                item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns, item.st_ctime_ns,
            )
            if identity(before) != identity(after) or sha256_fd(archive_fd) != expected_sha256:
                raise HandlerOutcomeUnknown(
                    "SOURCE_IDENTITY_DRIFT", "AFTER_SIDE_EFFECT", side_effects_started=True,
                )
        return output

    def volume_capacity(self, domain: str) -> bytes:
        spec = self.admitted_utility_specs.get(domain)
        if spec is None or spec["opcode"] != "capacity":
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_HELPER_OPCODE_INVALID")
        return self.start_volume_utility(domain)

    def restore_volume_archive(
            self, domain: str, archive_fd: int, expected_sha256: str,
    ) -> bytes:
        spec = self.admitted_utility_specs.get(domain)
        if spec is None or spec["opcode"] != "restore":
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_HELPER_OPCODE_INVALID")
        return self.start_volume_utility(
            domain, archive_fd=archive_fd, expected_sha256=expected_sha256,
        )

    def reconcile_volume_metadata(self, domain: str, reader_gid: int | None = None) -> bytes:
        spec = self.admitted_utility_specs.get(domain)
        expected = f"reconcile-{domain.replace('_', '-')}"
        if spec is None or spec["opcode"] != expected \
                or domain == "backup_status" and spec["arguments"] != [str(reader_gid)] \
                or domain != "backup_status" and reader_gid is not None:
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_HELPER_OPCODE_INVALID")
        return self.start_volume_utility(domain)

    def probe_volume(self, domain: str, reader_gid: int | None = None) -> bytes:
        spec = self.admitted_utility_specs.get(domain)
        expected_arguments = [domain] if domain != "backup_status" \
            else [domain, str(reader_gid)]
        if spec is None or spec["opcode"] != "probe" \
                or spec["arguments"] != expected_arguments \
                or domain != "backup_status" and reader_gid is not None:
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_HELPER_OPCODE_INVALID")
        return self.start_volume_utility(domain)

    def discover_volume_utility(self, domain: str) -> bytes:
        if domain not in {"uploads", "attachments", "backup_status"}:
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_DOMAIN_INVALID")
        utility = self.plan["targets"]["volumes"][domain]["utility_container"]
        return self._call([
            "ps", "--all", "--quiet", "--no-trunc", "--filter", f"name=^/{utility}$",
        ], timeout_seconds=60, maximum_output=64 * 1024)

    def register_volume_utility_discovery(self, domain: str, output: bytes) -> str | None:
        if domain not in {"uploads", "attachments", "backup_status"}:
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_DOMAIN_INVALID")
        if not isinstance(output, bytes) or len(output) > 64 * 1024:
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_UTILITY_DISCOVERY_INVALID")
        try:
            text = output.decode("ascii")
        except UnicodeDecodeError:
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_UTILITY_DISCOVERY_INVALID")
        identifiers = [item for item in text.splitlines() if item]
        if len(identifiers) > 1 or any(CONTAINER_ID.fullmatch(item) is None for item in identifiers):
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_UTILITY_DISCOVERY_INVALID")
        if not identifiers:
            self.pending_utility_ids.pop(domain, None)
            self.admitted_utility_ids.pop(domain, None)
            self.started_utility_ids.pop(domain, None)
            self.exited_utility_ids.pop(domain, None)
            self.pending_utility_specs.pop(domain, None)
            self.admitted_utility_specs.pop(domain, None)
            self.removed_utility_ids.pop(domain, None)
            return None
        identifier = identifiers[0]
        if domain not in self.pending_utility_specs and domain not in self.admitted_utility_specs:
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_UTILITY_STATE_INVALID")
        admitted = self.admitted_utility_ids.get(domain)
        if admitted is not None and admitted != identifier:
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_UTILITY_IDENTITY_DRIFT")
        self.pending_utility_ids[domain] = identifier
        return identifier

    def inspect_volume_utility(self, domain: str) -> bytes:
        identifiers = {
            mapping[domain] for mapping in (
                self.pending_utility_ids, self.admitted_utility_ids,
                self.started_utility_ids, self.exited_utility_ids,
            ) if domain in mapping
        }
        identifier = next(iter(identifiers)) if len(identifiers) == 1 else None
        if identifier is None:
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_UTILITY_NOT_DISCOVERED")
        return self._call([
            "inspect", "--type", "container", "--format", self.VOLUME_UTILITY_INSPECT_FORMAT,
            "--", identifier,
        ], timeout_seconds=60, maximum_output=1024 * 1024)

    def _validate_volume_utility_observation(
            self, domain: str, output: bytes, *, expected_status: str,
    ) -> tuple[str, dict[str, Any], dict[str, Any]]:
        code = "ROLLBACK_FIXED_EXECUTOR_VOLUME_UTILITY_IDENTITY_INVALID"
        identifier = self.pending_utility_ids.get(domain) \
            if expected_status == "created" else self.admitted_utility_ids.get(domain)
        spec = self.pending_utility_specs.get(domain) \
            if expected_status == "created" else self.admitted_utility_specs.get(domain)
        if domain not in {"uploads", "attachments", "backup_status"} \
                or identifier is None or spec is None \
                or expected_status not in {"created", "exited"} \
                or not isinstance(output, bytes) or not 2 <= len(output) <= 1024 * 1024:
            reject(code)
        try:
            value = json.loads(output.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            reject(code)
        if not isinstance(value, list) or len(value) != 29:
            reject(code)
        (
            observed_id, name, image_config_digest, image_reference, labels, status,
            exit_code, health, restart_count, oom_killed, mounts, user, entrypoint,
            command, working_directory, open_stdin, read_only_root, cap_drop, cap_add,
            security_options, network_mode, pids_limit, memory, memory_swap, nano_cpus,
            restart_policy, auto_remove, privileged, devices,
        ) = value
        helper = self.volume_helper
        expected_labels = {
            "chenyida.erp.uat-rollback-domain": domain,
            "chenyida.erp.uat-rollback-helper-config": helper["image_config_digest"],
            "chenyida.erp.uat-rollback-helper-opcode": spec["opcode"],
            "chenyida.erp.uat-rollback-operation": self.plan["rollback_operation_id"],
            "chenyida.erp.uat-rollback-runtime-plan": self.plan["runtime_plan_sha256"],
            "chenyida.erp.uat-rollback-volume-generation": spec["volume_generation"],
            "chenyida.erp.uat-rollback-volume-name": spec["volume_name"],
            "org.opencontainers.image.version": helper["application_version"],
            "org.opencontainers.image.revision": helper["git_commit"],
            "io.chenyida.erp.git-tree": helper["git_tree"],
            "io.chenyida.erp.image-role": helper["image_role"],
            "io.chenyida.erp.volume-helper.protocol": helper["protocol"],
            "io.chenyida.erp.volume-helper.toolchain-contract-sha256":
                helper["contract_sha256"],
        }
        expected_caps = sorted(spec["cap_add"])
        if observed_id != identifier \
                or name != f"/{self.plan['targets']['volumes'][domain]['utility_container']}" \
                or image_config_digest != helper["image_config_digest"] \
                or image_reference != helper["image_reference"] or status != expected_status \
                or not isinstance(exit_code, int) or isinstance(exit_code, bool) \
                or exit_code != 0 or health is not None or restart_count != 0 \
                or oom_killed is not False or not isinstance(labels, dict) \
                or any(labels.get(key) != expected for key, expected in expected_labels.items()) \
                or user != "0:0" or entrypoint != [VOLUME_HELPER_ENTRYPOINT] \
                or command != [spec["opcode"], *spec["arguments"]] \
                or working_directory != "/" or open_stdin is not spec["stdin_required"] \
                or read_only_root is not True \
                or self._normalize_capabilities(cap_drop) != ["ALL"] \
                or self._normalize_capabilities(cap_add) != expected_caps \
                or security_options != ["no-new-privileges"] or network_mode != "none" \
                or pids_limit != 64 or memory != 268435456 or memory_swap != 268435456 \
                or nano_cpus != 1_000_000_000 \
                or restart_policy != {"Name": "no", "MaximumRetryCount": 0} \
                or auto_remove is not False or privileged is not False \
                or devices not in (None, []) or not isinstance(mounts, list) \
                or len(mounts) != 1:
            reject(code)
        mount = mounts[0]
        if not isinstance(mount, dict) or mount.get("Type") != "volume" \
                or mount.get("Name") != spec["volume_name"] \
                or mount.get("Destination") != "/target" \
                or mount.get("RW") is not (not spec["read_only"]) \
                or mount.get("Driver") not in {"local", None} \
                or mount.get("Mode") not in {"", None} \
                or mount.get("Propagation") not in {"", None}:
            reject(code)
        projection = {
            "container_id": identifier, "name": name,
            "image_config_digest": image_config_digest,
            "image_reference": image_reference, "status": status,
            "labels": {key: labels[key] for key in sorted(expected_labels)},
            "mount": {
                "Type": mount["Type"], "Name": mount["Name"],
                "Destination": mount["Destination"], "RW": mount["RW"],
            },
            "command": command, "cap_add": expected_caps,
            "helper_image_admission_sha256": self.volume_helper_admission_sha256,
        }
        return identifier, spec, projection

    def admit_volume_utility(self, domain: str, output: bytes) -> str:
        identifier, spec, projection = self._validate_volume_utility_observation(
            domain, output, expected_status="created",
        )
        self.admitted_utility_ids[domain] = identifier
        self.admitted_utility_specs[domain] = spec
        self.pending_utility_ids.pop(domain, None)
        self.pending_utility_specs.pop(domain, None)
        return digest_value(projection)

    def verify_volume_utility_exited(self, domain: str, output: bytes) -> str:
        identifier, _spec, projection = self._validate_volume_utility_observation(
            domain, output, expected_status="exited",
        )
        self.exited_utility_ids[domain] = identifier
        return digest_value(projection)

    def remove_volume_utility(self, domain: str) -> bytes:
        identifier = self.admitted_utility_ids.get(domain)
        if domain not in {"uploads", "attachments", "backup_status"} or identifier is None:
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_UTILITY_NOT_ADMITTED")
        output = self._call(
            ["rm", "--force", "--", identifier],
            timeout_seconds=60, maximum_output=64 * 1024, effectful=True,
        )
        self.admitted_utility_ids.pop(domain, None)
        self.started_utility_ids.pop(domain, None)
        self.exited_utility_ids.pop(domain, None)
        self.admitted_utility_specs.pop(domain, None)
        self.removed_utility_ids[domain] = identifier
        return output

    def verify_volume_utility_removed(self, domain: str, discovery_output: bytes) -> str:
        removed = self.removed_utility_ids.get(domain)
        if removed is None:
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_UTILITY_REMOVE_UNVERIFIED")
        if self.register_volume_utility_discovery(domain, discovery_output) is not None:
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_UTILITY_REMOVE_UNVERIFIED")
        return digest_value({"domain": domain, "removed_container_id": removed, "present": False})

    def _postgres_psql_generated(
            self, database: str, phase: str, sql: bytes, *, effectful: bool,
            variables: dict[str, str] | None = None,
            session_write_override: bool = False,
            maximum_output: int = MAX_JSON_BYTES,
            observe_execution: bool = False,
    ) -> bytes:
        allowed_databases = {
            "postgres", *self.plan["targets"]["database"].values(),
        }
        selected_variables = variables or {}
        if database not in allowed_databases or not re.fullmatch(r"[a-z0-9_]{1,32}", phase) \
                or not isinstance(selected_variables, dict) \
                or len(selected_variables) > 8 \
                or any(re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", key) is None
                       or not isinstance(value, str) or not 1 <= len(value) <= 512
                       or any(ord(character) < 32 or ord(character) > 126
                              for character in value)
                       for key, value in selected_variables.items()) \
                or not isinstance(maximum_output, int) \
                or not MAX_JSON_BYTES <= maximum_output <= POSTGRES_CONTENT_REPORT_MAX_BYTES \
                or not isinstance(session_write_override, bool) \
                or session_write_override and (
                    database != self.plan["targets"]["database"]["staging"]
                    or not effectful and phase != "preswitchsecurity"
                ):
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_OPCODE_INVALID")
        postgres_id = self.plan["candidate"]["services"]["postgres"]["container_id"]
        token = self.plan["targets"]["database"]["staging"].rsplit("_", 1)[-1]
        arguments = [
            "exec", "--interactive", "--user", "999:999", "--env",
            f"PGAPPNAME=cyd_rb_{token}_{phase}",
            *(["--env", "PGOPTIONS=-c default_transaction_read_only=off"]
              if session_write_override else []),
            "--", postgres_id,
            "psql", "--no-psqlrc", "--quiet", "--no-align", "--tuples-only",
            "--field-separator=\t", "--host=/var/run/postgresql", "--port=5432",
            "--username=postgres", "--no-password", f"--dbname={database}",
            *(f"--set={key}={selected_variables[key]}"
              for key in sorted(selected_variables)),
            "--set=ON_ERROR_STOP=on",
            "--set=VERBOSITY=terse",
        ]
        sql_fd = self._sealed_input(sql, f"cyd-rb-{phase}", 1024 * 1024)
        try:
            return self._call(
                arguments, stdin_fd=sql_fd, timeout_seconds=300,
                maximum_output=maximum_output, effectful=effectful,
                observe_execution=observe_execution,
            )
        finally:
            os.close(sql_fd)

    def postgres_psql(self, opcode: str) -> bytes:
        opcodes = {
            "CONTROL_DATABASE_IDENTITY": (
                "postgres", "controlidentity",
                b"SELECT current_database(), current_setting('server_version_num');\n",
                False,
            ),
        }
        selected = opcodes.get(opcode) if isinstance(opcode, str) else None
        if selected is None:
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_OPCODE_INVALID")
        database, phase, sql, effectful = selected
        return self._postgres_psql_generated(
            database, phase, sql, effectful=effectful,
        )

    def postgres_sql_opcode(
            self, base: dict[str, Any], opcode_spec: dict[str, Any],
    ) -> bytes:
        base = validate_pg_rollback_base_spec(base)
        opcode_spec = validate_pg_opcode_spec(opcode_spec, base=base)
        planned_postgres = self.plan["candidate"]["services"]["postgres"]
        if base["runtime_plan_sha256"] != self.plan.get("runtime_plan_sha256") \
                or base["postgres"]["container_id"] != planned_postgres.get("container_id") \
                or base["postgres"]["image_reference"] \
                    != planned_postgres.get("image_reference") \
                or base["postgres"]["image_digest"] != planned_postgres.get("image_digest"):
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_OPCODE_SPEC_INVALID")
        sql = render_pg_sql(base, opcode_spec["opcode"], opcode_spec["bindings"])
        return self._postgres_psql_generated(
            opcode_spec["database"], opcode_spec["phase"], sql,
            effectful=opcode_spec["effectful"],
        )

    def _validate_postverify_postgres(self, base: dict[str, Any]) -> None:
        base = validate_pg_rollback_base_spec(base)
        planned = self.plan["candidate"]["services"]["postgres"]
        if base["runtime_plan_sha256"] != self.plan.get("runtime_plan_sha256") \
                or base["postgres"]["container_id"] != planned.get("container_id") \
                or base["postgres"]["image_reference"] != planned.get("image_reference") \
                or base["postgres"]["image_digest"] != planned.get("image_digest"):
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_POSTVERIFY_INVALID")

    def postgres_postverify_content(self, base: dict[str, Any]) -> bytes:
        self._validate_postverify_postgres(base)
        return self._postgres_psql_generated(
            base["databases"]["active_name"], "postverifycontent",
            embedded_postgres_sql(
                POSTGRES_CONTENT_SQL_ZLIB_BASE64, POSTGRES_CONTENT_SQL_SHA256,
            ),
            effectful=False, maximum_output=POSTGRES_CONTENT_REPORT_MAX_BYTES,
        )

    def postgres_preswitch_content(self, base: dict[str, Any]) -> bytes:
        self._validate_postverify_postgres(base)
        return self._postgres_psql_generated(
            base["databases"]["staging_name"], "preswitchcontent",
            embedded_postgres_sql(
                POSTGRES_CONTENT_SQL_ZLIB_BASE64, POSTGRES_CONTENT_SQL_SHA256,
            ),
            effectful=False, maximum_output=POSTGRES_CONTENT_REPORT_MAX_BYTES,
        )

    def postgres_postverify_security(
            self, base: dict[str, Any], inputs: CapabilityInputs,
    ) -> bytes:
        return self._postgres_runtime_security_state(
            base, inputs, database=base["databases"]["active_name"],
            marker=base["databases"]["candidate_marker"], sealed_staging=False,
        )

    def postgres_preswitch_security(
            self, base: dict[str, Any], inputs: CapabilityInputs,
    ) -> bytes:
        return self._postgres_runtime_security_state(
            base, inputs, database=base["databases"]["staging_name"],
            marker=base["databases"]["staging_marker"], sealed_staging=True,
        )

    def _postgres_runtime_security_state(
            self, base: dict[str, Any], inputs: CapabilityInputs, *,
            database: str, marker: str, sealed_staging: bool,
    ) -> bytes:
        self._validate_postverify_postgres(base)
        policy = inputs.json("snapshot_runtime_privilege_policy")
        try:
            migration_owner = policy["identities"]["migration_owner"]
        except (KeyError, TypeError):
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_POSTVERIFY_INVALID")
        if migration_owner != base["security"]["database_owner"]:
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_POSTVERIFY_INVALID")
        return self._postgres_psql_generated(
            database, "preswitchsecurity" if sealed_staging else "postverifysecurity",
            embedded_postgres_sql(
                POSTGRES_SECURITY_SQL_ZLIB_BASE64, POSTGRES_SECURITY_SQL_SHA256,
            ),
            effectful=False,
            variables={
                "sealed_staging_mode" if sealed_staging
                    else "controlled_runtime_mode": "1",
                "expected_database": database,
                "expected_marker": marker,
                "expected_system_identifier": base["postgres"]["system_identifier"],
                "migration_owner": migration_owner,
            },
            session_write_override=sealed_staging,
        )

    def _postverify_database(self, database: str, *, sealed_staging: bool = False) -> None:
        expected = self.plan["targets"]["database"][
            "staging" if sealed_staging else "active"
        ]
        if database != expected:
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_POSTVERIFY_INVALID")

    def postgres_postverify_migrations(
            self, database: str, *, sealed_staging: bool = False,
    ) -> bytes:
        self._postverify_database(database, sealed_staging=sealed_staging)
        return self._postgres_psql_generated(
            database, "preswitchmigrations" if sealed_staging else "postverifymigrations",
            b"BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;\n"
            b"SET LOCAL lock_timeout='5s';\n"
            b"SET LOCAL statement_timeout='60s';\n"
            b"SET LOCAL idle_in_transaction_session_timeout='15s';\n"
            b"SELECT checksum||'  '||version FROM public.schema_migrations "
            b"ORDER BY version;\nCOMMIT;\n",
            effectful=False,
        )

    def postgres_postverify_sessions(
            self, database: str, *, sealed_staging: bool = False,
    ) -> bytes:
        self._postverify_database(database, sealed_staging=sealed_staging)
        database_literal = _pg_literal(database)
        sql = f"""BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL idle_in_transaction_session_timeout='15s';
WITH grouped AS (
  SELECT usename::text AS role,application_name::text AS application_name,
    state::text,count(*)::integer AS count
  FROM pg_catalog.pg_stat_activity
  WHERE datname={database_literal} AND backend_type='client backend'
    AND pid<>pg_catalog.pg_backend_pid()
  GROUP BY usename,application_name,state
), body AS (
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'role',role,'application_name',application_name,'state',state,'count',count)
    ORDER BY role COLLATE \"C\",application_name COLLATE \"C\",state COLLATE \"C\"),
    '[]'::jsonb) AS sessions,
    coalesce(sum(count),0)::integer AS total
  FROM grouped
)
SELECT pg_catalog.jsonb_build_object(
  'database',{database_literal},'sessions',sessions,'total',total
)::text FROM body;
COMMIT;
""".encode("utf-8")
        return self._postgres_psql_generated(
            database, "preswitchsessions" if sealed_staging else "postverifysessions",
            sql, effectful=False,
        )

    def postgres_postverify_identity(
            self, database: str, *, sealed_staging: bool = False,
    ) -> bytes:
        self._postverify_database(database, sealed_staging=sealed_staging)
        sql = b"""BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL idle_in_transaction_session_timeout='15s';
SELECT pg_catalog.jsonb_build_object(
  'name',d.datname,'system_identifier',c.system_identifier::text,
  'oid',d.oid::text,'marker',pg_catalog.shobj_description(d.oid,'pg_database'),
  'allow_connections',d.datallowconn,'connection_limit',d.datconnlimit,
  'default_transaction_read_only',EXISTS(
    SELECT 1 FROM pg_catalog.pg_db_role_setting s
    WHERE s.setdatabase=d.oid AND s.setrole=0
      AND 'default_transaction_read_only=on'=ANY(s.setconfig)),
  'prepared_xacts',(SELECT count(*) FROM pg_catalog.pg_prepared_xacts x
                    WHERE x.database=d.datname)
)::text
FROM pg_catalog.pg_database d CROSS JOIN pg_catalog.pg_control_system() c
WHERE d.datname=current_database();
COMMIT;
"""
        return self._postgres_psql_generated(
            database, "preswitchidentity" if sealed_staging else "postverifyidentity",
            sql, effectful=False,
        )

    def writer_sql_opcode(
            self, spec: dict[str, Any], opcode_spec: dict[str, Any],
    ) -> bytes:
        spec = validate_writer_containment_spec(spec)
        opcode_spec = validate_writer_opcode_spec(opcode_spec, spec=spec)
        planned = self.plan["candidate"]["services"]["postgres"]
        if spec["runtime_plan_sha256"] != self.plan.get("runtime_plan_sha256") \
                or spec["postgres"]["container_id"] != planned.get("container_id") \
                or spec["postgres"]["image_reference"] != planned.get("image_reference") \
                or spec["postgres"]["image_digest"] != planned.get("image_digest"):
            reject("ROLLBACK_FIXED_EXECUTOR_WRITER_OPCODE_INVALID")
        return self._postgres_psql_generated(
            opcode_spec["database"], opcode_spec["phase"],
            render_writer_sql(spec, opcode_spec["opcode"], opcode_spec["bindings"]),
            effectful=opcode_spec["effectful"],
        )

    def postgres_reconcile_opcode(
            self, base: dict[str, Any], inputs: CapabilityInputs,
            opcode_spec: dict[str, Any],
    ) -> bytes:
        base = validate_pg_rollback_base_spec(base)
        opcode_spec = validate_pg_reconcile_opcode_spec(
            opcode_spec, base=base, inputs=inputs,
        )
        planned_postgres = self.plan["candidate"]["services"]["postgres"]
        if base["runtime_plan_sha256"] != self.plan.get("runtime_plan_sha256") \
                or base["postgres"]["container_id"] != planned_postgres.get("container_id") \
                or base["postgres"]["image_reference"] \
                    != planned_postgres.get("image_reference") \
                or base["postgres"]["image_digest"] != planned_postgres.get("image_digest"):
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_RECONCILIATION_INVALID")
        sql = render_pg_reconciliation_sql(base, inputs, opcode_spec["bindings"])
        return self._postgres_psql_generated(
            opcode_spec["database"], opcode_spec["phase"], sql, effectful=True,
            session_write_override=True,
            observe_execution=True,
        )

    def postgres_guarded_switch_opcode(
            self, base: dict[str, Any], inputs: CapabilityInputs,
            opcode_spec: dict[str, Any],
    ) -> bytes:
        base = validate_pg_rollback_base_spec(base)
        opcode_spec = validate_pg_guarded_switch_opcode_spec(
            opcode_spec, base=base, inputs=inputs,
        )
        planned_postgres = self.plan["candidate"]["services"]["postgres"]
        if base["runtime_plan_sha256"] != self.plan.get("runtime_plan_sha256") \
                or base["postgres"]["container_id"] \
                    != planned_postgres.get("container_id") \
                or base["postgres"]["image_reference"] \
                    != planned_postgres.get("image_reference") \
                or base["postgres"]["image_digest"] \
                    != planned_postgres.get("image_digest"):
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_GUARDED_SWITCH_INVALID")
        try:
            migration_owner = inputs.json(
                "snapshot_runtime_privilege_policy",
            )["identities"]["migration_owner"]
        except (KeyError, TypeError, FixedExecutorError):
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_GUARDED_SWITCH_INVALID")
        sql = render_pg_guarded_switch_sql(base, inputs, opcode_spec["bindings"])
        return self._postgres_psql_generated(
            opcode_spec["database"], opcode_spec["phase"], sql, effectful=True,
            variables={
                "capture_security_state": "1",
                "sealed_staging_mode": "1",
                "expected_database": base["databases"]["staging_name"],
                "expected_marker": base["databases"]["staging_marker"],
                "expected_system_identifier": base["postgres"]["system_identifier"],
                "migration_owner": migration_owner,
            },
            session_write_override=True,
            observe_execution=True,
        )

    def postgres_capacity(self) -> bytes:
        postgres_id = self.plan["candidate"]["services"]["postgres"]["container_id"]
        return self._call([
            "exec", "--user", "999:999", "--", postgres_id,
            "df", "--block-size=1", "--output=avail", "/var/lib/postgresql/data",
        ], timeout_seconds=60, maximum_output=64 * 1024)

    @staticmethod
    def _prepare_postgres_dump(
            dump_fd: int, expected_sha256: str, expected_bytes: int,
    ) -> tuple[int, int, int, int, int]:
        code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_DUMP_INVALID"
        if not isinstance(dump_fd, int) or dump_fd < 3 \
                or SHA256.fullmatch(expected_sha256 or "") is None \
                or isinstance(expected_bytes, bool) or not isinstance(expected_bytes, int) \
                or not 1 <= expected_bytes <= 64 * 1024 * 1024 * 1024:
            reject(code)
        try:
            metadata = os.fstat(dump_fd)
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_size != expected_bytes \
                    or metadata.st_uid != 0 or metadata.st_gid != 0 \
                    or metadata.st_nlink != 1 or stat.S_IMODE(metadata.st_mode) != 0o400 \
                    or sha256_fd(dump_fd) != expected_sha256:
                reject(code)
            os.lseek(dump_fd, 0, os.SEEK_SET)
        except OSError:
            reject(code)
        return (
            metadata.st_dev, metadata.st_ino, metadata.st_size,
            metadata.st_mtime_ns, metadata.st_ctime_ns,
        )

    @staticmethod
    def _postgres_dump_unchanged(
            dump_fd: int, expected_identity: tuple[int, int, int, int, int],
            expected_sha256: str,
    ) -> bool:
        try:
            metadata = os.fstat(dump_fd)
        except OSError:
            return False
        identity = (
            metadata.st_dev, metadata.st_ino, metadata.st_size,
            metadata.st_mtime_ns, metadata.st_ctime_ns,
        )
        return identity == expected_identity and sha256_fd(dump_fd) == expected_sha256

    def postgres_restore_list(
            self, dump_fd: int, expected_sha256: str, expected_bytes: int,
    ) -> bytes:
        before = self._prepare_postgres_dump(dump_fd, expected_sha256, expected_bytes)
        postgres_id = self.plan["candidate"]["services"]["postgres"]["container_id"]
        output = self._call([
            "exec", "--interactive", "--user", "999:999", "--env", "LC_ALL=C",
            "--env", "LANG=C", "--", postgres_id,
            "pg_restore", "--format=custom", "--no-password", "--list",
        ], stdin_fd=dump_fd, timeout_seconds=300, maximum_output=MAX_JSON_BYTES)
        if not self._postgres_dump_unchanged(dump_fd, before, expected_sha256):
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_DUMP_INVALID")
        return output

    def postgres_restore_staging(
            self, dump_fd: int, expected_sha256: str, expected_bytes: int,
    ) -> bytes:
        before = self._prepare_postgres_dump(dump_fd, expected_sha256, expected_bytes)
        postgres_id = self.plan["candidate"]["services"]["postgres"]["container_id"]
        staging = self.plan["targets"]["database"]["staging"]
        token = staging.rsplit("_", 1)[-1]
        output = self._call([
            "exec", "--interactive", "--user", "999:999", "--env",
            f"PGAPPNAME=cyd_rb_{token}_restore", "--env", "LC_ALL=C",
            "--env", "LANG=C", "--env",
            "PGOPTIONS=-c default_transaction_read_only=off", "--", postgres_id,
            "pg_restore", "--host=/var/run/postgresql", "--port=5432",
            "--username=postgres", "--no-password", f"--dbname={staging}",
            "--format=custom", "--no-owner", "--no-acl", "--no-tablespaces",
            "--exit-on-error", "--single-transaction",
        ], stdin_fd=dump_fd, timeout_seconds=1800, maximum_output=MAX_JSON_BYTES,
            effectful=True)
        if not self._postgres_dump_unchanged(dump_fd, before, expected_sha256):
            raise HandlerOutcomeUnknown(
                "SOURCE_IDENTITY_DRIFT", "AFTER_SIDE_EFFECT", side_effects_started=True,
            )
        return output

    def postgres_dump_opcode(
            self, base: dict[str, Any], opcode_spec: dict[str, Any], dump_fd: int,
    ) -> bytes:
        base = validate_pg_rollback_base_spec(base)
        opcode_spec = validate_pg_dump_opcode_spec(opcode_spec, base=base)
        planned_postgres = self.plan["candidate"]["services"]["postgres"]
        if base["runtime_plan_sha256"] != self.plan.get("runtime_plan_sha256") \
                or base["postgres"]["container_id"] != planned_postgres.get("container_id") \
                or base["postgres"]["image_reference"] \
                    != planned_postgres.get("image_reference") \
                or base["postgres"]["image_digest"] != planned_postgres.get("image_digest"):
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_DUMP_OPCODE_SPEC_INVALID")
        bindings = opcode_spec["bindings"]
        if opcode_spec["opcode"] == "PG_RB_LIST_DUMP_V1":
            return self.postgres_restore_list(
                dump_fd, bindings["dump_sha256"], bindings["dump_bytes"],
            )
        precondition_opcode = derive_pg_opcode_spec(
            base, "PG_RB_OBSERVE_STAGING_RESTORE_PRECONDITION_V1", {
                "create_receipt_sha256": bindings["create_receipt_sha256"],
                "staging_oid": bindings["staging_oid"],
                "dump_inventory_sha256": bindings["dump_inventory_sha256"],
                "expected_empty_projection_sha256":
                    bindings["empty_projection_sha256"],
            },
        )
        if precondition_opcode["opcode_spec_sha256"] \
                != bindings["restore_precondition_opcode_spec_sha256"]:
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_RESTORE_PRECONDITION_INVALID")
        adjacent_precondition = parse_pg_restore_precondition(
            self.postgres_sql_opcode(base, precondition_opcode),
            base=base, opcode_spec=precondition_opcode,
        )
        if adjacent_precondition["restore_precondition_sha256"] \
                != bindings["restore_precondition_sha256"]:
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_RESTORE_PRECONDITION_DRIFT")
        return self.postgres_restore_staging(
            dump_fd, bindings["dump_sha256"], bindings["dump_bytes"],
        )

    def _validate(self, arguments: list[str], environment: dict[str, str]) -> None:
        invocation = (tuple(arguments), tuple(sorted(environment.items())))
        if self._authorized_invocation != invocation:
            reject("ROLLBACK_FIXED_EXECUTOR_DOCKER_ARGV_INVALID")

    @staticmethod
    def _kill_group(process: subprocess.Popen[bytes]) -> None:
        group_id = process.pid
        try:
            os.killpg(group_id, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass
        try:
            process.wait(timeout=0.25)
        except subprocess.TimeoutExpired:
            pass
        deadline = time.monotonic() + 2
        while ClosedDockerRunner._group_exists(group_id) and time.monotonic() < deadline:
            time.sleep(0.02)
        if not ClosedDockerRunner._group_exists(group_id):
            return
        try:
            os.killpg(group_id, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
        try:
            if process.poll() is None:
                process.wait(timeout=0.25)
        except subprocess.TimeoutExpired:
            pass
        deadline = time.monotonic() + 2
        while ClosedDockerRunner._group_exists(group_id) and time.monotonic() < deadline:
            time.sleep(0.02)

    @staticmethod
    def _group_exists(group_id: int) -> bool:
        try:
            os.killpg(group_id, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            return True

    def _observe_completed_execution(
            self, *, arguments: list[str], environment: dict[str, str],
            stdin_present: bool, stdin_bytes: int,
            stdin_sha256: str | None, timeout_seconds: float,
            maximum_output: int, side_effects_started: bool, return_code: int,
            stdout: bytes, stderr: bytes,
    ) -> None:
        if self.execution_observer is None:
            return
        event = {
            "arguments": list(arguments),
            "environment": dict(sorted(environment.items())),
            "stdin_present": stdin_present,
            "stdin_bytes": stdin_bytes,
            "stdin_sha256": stdin_sha256,
            "timeout_milliseconds": int(round(timeout_seconds * 1000)),
            "maximum_output_bytes": maximum_output,
            "side_effects_started": side_effects_started,
            "return_code": return_code,
            "stdout": bytes(stdout),
            "stderr": bytes(stderr),
            "daemon_state": "COMPLETED_NO_UNTRACKED_PROCESS",
        }
        failed = False
        try:
            result = self.execution_observer(event)
        except Exception:
            failed = True
            result = None
        if failed or result is not None:
            if side_effects_started:
                raise HandlerOutcomeUnknown(
                    "SIDE_EFFECT_OUTCOME_UNKNOWN", "AFTER_SIDE_EFFECT",
                    side_effects_started=True,
                )
            reject("ROLLBACK_FIXED_EXECUTOR_EXECUTION_OBSERVER_INVALID")

    def _run_generated(
            self, arguments: list[str], *, stdin_fd: int | None = None,
            environment: dict[str, str] | None = None, timeout_seconds: float = 60,
            maximum_output: int = MAX_JSON_BYTES, side_effects_started: bool = False,
            observe_execution: bool = False,
    ) -> bytes:
        selected_environment = environment or {}
        self._validate(arguments, selected_environment)
        stdin_sha256 = None
        stdin_bytes = 0
        if stdin_fd is not None:
            try:
                metadata = os.fstat(stdin_fd)
                if observe_execution and self.execution_observer is not None:
                    stdin_bytes = metadata.st_size
                    stdin_sha256 = sha256_fd(stdin_fd)
            except OSError:
                reject("ROLLBACK_FIXED_EXECUTOR_DOCKER_STDIN_INVALID")
        if not 0.1 <= timeout_seconds <= 1800 or not 1 <= maximum_output <= 64 * 1024 * 1024:
            reject("ROLLBACK_FIXED_EXECUTOR_DOCKER_LIMIT_INVALID")
        executable = f"/proc/self/fd/{self.docker_fd}"
        environment_value = {
            "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent",
            **selected_environment,
        }
        try:
            process = subprocess.Popen(
                [executable, *arguments], cwd="/", env=environment_value,
                stdin=stdin_fd if stdin_fd is not None else subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                pass_fds=(self.docker_fd,) if stdin_fd is None else (self.docker_fd, stdin_fd),
                start_new_session=True,
            )
        except OSError:
            reject("ROLLBACK_FIXED_EXECUTOR_DOCKER_EXEC_FAILED")
        assert process.stdout is not None and process.stderr is not None
        selector = selectors.DefaultSelector()
        streams = {"stdout": bytearray(), "stderr": bytearray()}
        deadline = time.monotonic() + timeout_seconds
        try:
            for stream, name in ((process.stdout, "stdout"), (process.stderr, "stderr")):
                os.set_blocking(stream.fileno(), False)
                selector.register(stream, selectors.EVENT_READ, name)
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    self._kill_group(process)
                    raise HandlerOutcomeUnknown(
                        "TOOL_TIMEOUT", "AFTER_SIDE_EFFECT" if side_effects_started
                        else "BEFORE_SIDE_EFFECT", side_effects_started=side_effects_started,
                    )
                for selected, _mask in selector.select(min(remaining, 0.25)):
                    try:
                        chunk = os.read(selected.fileobj.fileno(), 65536)
                    except BlockingIOError:
                        continue
                    if not chunk:
                        selector.unregister(selected.fileobj)
                        continue
                    streams[selected.data].extend(chunk)
                    if len(streams[selected.data]) > maximum_output:
                        self._kill_group(process)
                        raise HandlerOutcomeUnknown(
                            "TOOL_OUTPUT_LIMIT", "AFTER_SIDE_EFFECT" if side_effects_started
                            else "BEFORE_SIDE_EFFECT", side_effects_started=side_effects_started,
                        )
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                self._kill_group(process)
                raise HandlerOutcomeUnknown(
                    "TOOL_TIMEOUT", "AFTER_SIDE_EFFECT" if side_effects_started
                    else "BEFORE_SIDE_EFFECT", side_effects_started=side_effects_started,
                )
            try:
                return_code = process.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                self._kill_group(process)
                raise HandlerOutcomeUnknown(
                    "TOOL_TIMEOUT", "AFTER_SIDE_EFFECT" if side_effects_started
                    else "BEFORE_SIDE_EFFECT", side_effects_started=side_effects_started,
                )
            if return_code < 0:
                raise HandlerOutcomeUnknown(
                    "TOOL_SIGNAL", "AFTER_SIDE_EFFECT" if side_effects_started
                    else "BEFORE_SIDE_EFFECT", side_effects_started=side_effects_started,
                )
            if self._group_exists(process.pid):
                self._kill_group(process)
                raise HandlerOutcomeUnknown(
                    "TOOL_DAEMON_LEFT_RUNNING", "AFTER_SIDE_EFFECT" if side_effects_started
                    else "BEFORE_SIDE_EFFECT", side_effects_started=side_effects_started,
                )
            if observe_execution and self.execution_observer is not None:
                self._observe_completed_execution(
                    arguments=arguments, environment=environment_value,
                    stdin_present=stdin_fd is not None, stdin_bytes=stdin_bytes,
                    stdin_sha256=stdin_sha256, timeout_seconds=timeout_seconds,
                    maximum_output=maximum_output,
                    side_effects_started=side_effects_started,
                    return_code=return_code, stdout=bytes(streams["stdout"]),
                    stderr=bytes(streams["stderr"]),
                )
            if return_code != 0 or streams["stderr"]:
                if side_effects_started:
                    raise HandlerOutcomeUnknown(
                        "SIDE_EFFECT_OUTCOME_UNKNOWN", "AFTER_SIDE_EFFECT",
                        side_effects_started=True,
                    )
                reject("ROLLBACK_FIXED_EXECUTOR_DOCKER_COMMAND_FAILED")
            return bytes(streams["stdout"])
        finally:
            selector.close()
            for stream in (process.stdout, process.stderr):
                try:
                    stream.close()
                except OSError:
                    pass
            if process.poll() is None:
                self._kill_group(process)


class ClosedRuntimeOperationDriver:
    """Complete-project observation and durable emergency containment for operation actions."""

    def __init__(self, runner: ClosedDockerRunner, *, clock: Any = utc_now):
        self.runner = runner
        self.clock = clock

    @staticmethod
    def _utility_observation(
            raw: bytes, *, name: str,
    ) -> dict[str, Any]:
        code = "ROLLBACK_FIXED_EXECUTOR_RUNTIME_OBSERVATION_INVALID"
        if not isinstance(raw, bytes) or len(raw) > 64 * 1024 \
                or not IDENTIFIER.fullmatch(name or ""):
            reject(code)
        try:
            identifiers = [item for item in raw.decode("ascii").splitlines() if item]
        except UnicodeDecodeError:
            reject(code)
        if len(identifiers) > 1 \
                or any(CONTAINER_ID.fullmatch(item or "") is None for item in identifiers):
            reject(code)
        return {
            "name": name, "present": bool(identifiers),
            "container_id": identifiers[0] if identifiers else None,
        }

    def _volume(self, name: str) -> dict[str, Any] | None:
        if not self.runner.parse_volume_discovery(
                self.runner.discover_volume(name), name,
        ):
            return None
        return parse_volume_inspection(
            self.runner.inspect_volumes([name]), name,
        )

    def observe(self, inputs: CapabilityInputs) -> dict[str, Any]:
        plan = inputs.plan
        identifiers = parse_runtime_project_container_discovery(
            self.runner.discover_project_containers(),
        )
        self.runner.register_discovered_containers(identifiers)
        container_state = parse_runtime_container_observation(
            self.runner.inspect_containers(identifiers),
            plan=plan, discovered_ids=identifiers,
        )
        self.runner.admit_runtime_writers([
            item["container_id"] for item in container_state["writer_inventory"]["members"]
        ])
        database_state = parse_runtime_database_observation(
            self.runner.postgres_runtime_observation(), plan=plan,
        )
        retained: dict[str, dict[str, Any]] = {}
        active_volumes: dict[str, dict[str, str]] = {}
        derived_volumes: dict[str, dict[str, Any]] = {}
        candidate_observations: dict[str, dict[str, Any] | None] = {}
        target_observations: dict[str, dict[str, Any] | None] = {}
        for domain in ("uploads", "attachments", "backup_status"):
            candidate = plan["candidate"]["volumes"][domain]
            target = plan["targets"]["volumes"][domain]
            candidate_observation = self._volume(candidate["name"])
            target_observation = self._volume(target["target"])
            candidate_observations[domain] = candidate_observation
            target_observations[domain] = target_observation
            retained[domain] = {
                "domain": domain, "name": candidate["name"],
                "present": candidate_observation is not None,
                "identity_sha256": None if candidate_observation is None
                else candidate_observation["identity_sha256"],
            }
            utility = self._utility_observation(
                self.runner.discover_volume_utility(domain),
                name=target["utility_container"],
            )
            derived_volumes[domain] = {
                "target": {
                    "name": target["target"], "present": target_observation is not None,
                    "identity_sha256": None if target_observation is None
                    else target_observation["identity_sha256"],
                },
                "utility_container": utility,
            }
            active_name = container_state["active_volume_names"][domain]
            if active_name == candidate["name"]:
                active_observation = candidate_observation
            elif active_name == target["target"]:
                active_observation = target_observation
            else:
                reject("ROLLBACK_FIXED_EXECUTOR_RUNTIME_OBSERVATION_INVALID")
            if active_observation is None:
                reject("ROLLBACK_FIXED_EXECUTOR_RUNTIME_OBSERVATION_INVALID")
            active_volumes[domain] = {
                "domain": domain, "name": active_name,
                "identity_sha256": active_observation["identity_sha256"],
            }

        database = database_state["database"]
        generations = container_state["service_generations"]
        candidate_active = all(
            generations[service] == "CANDIDATE" for service in ("web", "worker")
        ) and all(
            active_volumes[domain]["name"]
                == plan["candidate"]["volumes"][domain]["name"]
            for domain in ("uploads", "attachments", "backup_status")
        ) and database["oid"] == plan["deployment"]["database"]["oid"] \
            and not database_state["derived_database"]["staging"]["present"] \
            and not database_state["derived_database"]["candidate_quarantine"]["present"]
        predecessor_active = all(
            generations[service] == "PREDECESSOR" for service in ("web", "worker")
        ) and all(
            active_volumes[domain]["name"] == plan["targets"]["volumes"][domain]["target"]
            for domain in ("uploads", "attachments", "backup_status")
        ) and database["oid"] != plan["deployment"]["database"]["oid"] \
            and not database_state["derived_database"]["staging"]["present"] \
            and database_state["derived_database"]["candidate_quarantine"]["present"] \
            and database_state["derived_database"]["candidate_quarantine"]["oid"] \
                == plan["deployment"]["database"]["oid"]
        active_generation = "CANDIDATE" if candidate_active \
            else "PREDECESSOR" if predecessor_active else "PARTIAL_OR_UNKNOWN"
        body = {
            "schema_version": 1, "contract": RUNTIME_OBSERVATION_CONTRACT,
            "active_generation": active_generation, "database": database,
            "services": container_state["services"],
            "writer_inventory": container_state["writer_inventory"],
            "volumes": active_volumes, "retained_candidate_volumes": retained,
            "derived_targets": {
                "database": database_state["derived_database"],
                "volumes": derived_volumes,
            },
            "protected_resources_sha256":
                plan["candidate"]["protected_resources_sha256"],
        }
        return {**body, "observation_sha256": digest_value(body)}

    @staticmethod
    def _candidate_resources_exact(
            observation: dict[str, Any], plan: dict[str, Any],
    ) -> bool:
        return all(
            observation["retained_candidate_volumes"][domain] == {
                **plan["candidate"]["volumes"][domain], "present": True,
            }
            for domain in ("uploads", "attachments", "backup_status")
        )

    @classmethod
    def _exact_predecessor(
            cls, observation: dict[str, Any], plan: dict[str, Any],
    ) -> bool:
        expected_digest = lambda reference: "sha256:" + reference.rsplit(
            "@sha256:", 1,
        )[-1]
        return observation["active_generation"] == "PREDECESSOR" \
            and observation["database"]["name"] == plan["deployment"]["database"]["name"] \
            and observation["database"]["system_identifier"] \
                == plan["deployment"]["database"]["system_identifier"] \
            and observation["database"]["marker"] \
                == plan["deployment"]["database"]["marker"] \
            and observation["database"]["oid"] != plan["deployment"]["database"]["oid"] \
            and observation["database"]["allow_connections"] is True \
            and observation["database"]["writer_sessions"] == 0 \
            and observation["database"]["sealed"] is False \
            and all(
                all(observation["services"][service][field]
                    == plan["candidate"]["services"][service][field]
                    for field in ("service", "container_id", "image_reference", "image_digest"))
                for service in ("caddy", "postgres")
            ) \
            and all(
                observation["services"][service]["image_reference"]
                    == plan["predecessor"][f"{service}_image"]
                and observation["services"][service]["image_digest"]
                    == expected_digest(plan["predecessor"][f"{service}_image"])
                and observation["services"][service]["container_id"]
                    != plan["candidate"]["services"][service]["container_id"]
                for service in ("web", "worker")
            ) \
            and all(
                item["running"] is True and item["restart_count"] == 0
                and item["oom_killed"] is False
                and item["health"] == ("none" if service == "caddy" else "healthy")
                for service, item in observation["services"].items()
            ) \
            and observation["writer_inventory"]["active_writer_count"] == 2 \
            and observation["writer_inventory"]["unexpected_writer_count"] == 0 \
            and len(observation["writer_inventory"]["members"]) == 2 \
            and not observation["derived_targets"]["database"]["staging"]["present"] \
            and observation["derived_targets"]["database"]["candidate_quarantine"]["present"] \
            and observation["derived_targets"]["database"]["candidate_quarantine"]["oid"] \
                == plan["deployment"]["database"]["oid"] \
            and cls._candidate_resources_exact(observation, plan) \
            and all(
                observation["volumes"][domain]["name"]
                    == plan["targets"]["volumes"][domain]["target"]
                and observation["volumes"][domain]["identity_sha256"]
                    == observation["derived_targets"]["volumes"][domain]["target"]
                        ["identity_sha256"]
                and observation["volumes"][domain]["identity_sha256"]
                    != plan["candidate"]["volumes"][domain]["identity_sha256"]
                and observation["derived_targets"]["volumes"][domain]["target"]["present"]
                    is True
                and observation["derived_targets"]["volumes"][domain]
                    ["utility_container"]["present"] is False
                for domain in ("uploads", "attachments", "backup_status")
            )

    @classmethod
    def target_state(cls, observation: dict[str, Any], plan: dict[str, Any]) -> str:
        if observation == create_runtime_original_observation(plan):
            return "SAFE_TO_EXECUTE"
        if cls._exact_predecessor(observation, plan):
            return "EXACT_RESULT_ALREADY_DURABLE"
        if not cls._candidate_resources_exact(observation, plan) or any(
            observation["volumes"][domain]["name"]
                != plan["candidate"]["volumes"][domain]["name"]
            and observation["volumes"][domain]["identity_sha256"]
                == plan["candidate"]["volumes"][domain]["identity_sha256"]
            for domain in ("uploads", "attachments", "backup_status")
        ):
            return "BLOCKED_TARGET_IDENTITY_MISMATCH"
        return "PARTIAL_OR_UNKNOWN_REQUIRES_CONTAINMENT"

    def gate(self, inputs: CapabilityInputs) -> dict[str, Any]:
        observation = self.observe(inputs)
        plan = inputs.plan
        status = self.target_state(observation, plan)
        action = inputs.request["action"]
        if action not in {"PREFLIGHT", "RECHECK"}:
            reject("ROLLBACK_FIXED_EXECUTOR_DISPATCH_INVALID")
        output = {
            "result": "ROLLBACK_RUNTIME_PREFLIGHT_PASSED" if action == "PREFLIGHT"
                else "ROLLBACK_RUNTIME_RECHECK_PASSED",
            "execution_package_sha256": inputs.request["execution_package_sha256"],
            "source_set_sha256": inputs.request["source_set_sha256"],
            "runtime_plan_sha256": plan["runtime_plan_sha256"],
            "runtime_activation_source_sha256":
                inputs.package["sources"]["runtime_adapter_activation"]["sha256"],
            "executor_sha256": inputs.manifest["executor"]["sha256"],
            "deployment_identity_sha256": digest_value(plan["deployment"]),
            "protected_resources_sha256":
                plan["candidate"]["protected_resources_sha256"],
            "target_state": status, "observed": observation,
        }
        return {"status": status, "output": output}

    @staticmethod
    def _journal(inputs: CapabilityInputs, filesystem_root: str) -> HandlerJournal:
        label = "RUNTIME_CONTAIN_" + inputs.request["record_intent_sha256"][:32].upper()
        return HandlerJournal(
            inputs.request["operation"], inputs.request["operation_id"], label,
            filesystem_root,
        )

    @staticmethod
    def _contained_event(events: list[dict[str, Any]]) -> dict[str, Any] | None:
        selected = [item for item in events if item["event"] == "CONTAINED"]
        if len(selected) > 1:
            reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_CHAIN_INVALID")
        return None if not selected else selected[0]

    def probe(self, inputs: CapabilityInputs, filesystem_root: str) -> dict[str, Any]:
        observation = self.observe(inputs)
        journal = self._journal(inputs, filesystem_root)
        contained = self._contained_event(journal.load())
        if contained is not None and contained.get("payload", {}).get("observed") == observation:
            return {"status": "CONTAINED", "output": contained["payload"]}
        return {
            "status": "PARTIAL_OR_UNKNOWN",
            "output": {
                "containment": {
                    "status": "NOT_CONTAINED",
                    "runtime_observation_sha256": observation["observation_sha256"],
                },
                "observed": observation,
            },
        }

    @staticmethod
    def _validate_transition(
            before: dict[str, Any], after: dict[str, Any],
    ) -> list[dict[str, str]]:
        code = "ROLLBACK_FIXED_EXECUTOR_RUNTIME_CONTAINMENT_INVALID"
        stable_database = {
            **before["database"], "allow_connections": False,
            "writer_sessions": 0, "sealed": True,
        }
        before_members = before["writer_inventory"]["members"]
        after_members = after["writer_inventory"]["members"]
        identities = lambda members: [{
            key: item[key] for key in (
                "writer_key", "service", "container_id", "unexpected",
            )
        } for item in members]
        stable_service_fields = (
            "service", "container_id", "image_reference", "image_digest",
            "restart_count", "oom_killed",
        )
        if after["database"] != stable_database \
                or after["active_generation"] != before["active_generation"] \
                or after["volumes"] != before["volumes"] \
                or after["retained_candidate_volumes"] \
                    != before["retained_candidate_volumes"] \
                or after["derived_targets"] != before["derived_targets"] \
                or after["protected_resources_sha256"] \
                    != before["protected_resources_sha256"] \
                or any(after["services"][service] != before["services"][service]
                       for service in ("caddy", "postgres")) \
                or any(any(after["services"][service][field]
                           != before["services"][service][field]
                           for field in stable_service_fields)
                       or after["services"][service]["running"] is not False
                       or after["services"][service]["health"] != "stopped"
                       for service in ("web", "worker")) \
                or identities(after_members) != identities(before_members) \
                or any(item["running"] for item in after_members) \
                or after["writer_inventory"]["active_writer_count"] != 0 \
                or after["writer_inventory"]["unexpected_writer_count"] \
                    != before["writer_inventory"]["unexpected_writer_count"] \
                or after["writer_inventory"]["writer_set_sha256"] \
                    != before["writer_inventory"]["writer_set_sha256"]:
            reject(code)
        return [{
            "writer_key": item["writer_key"], "service": item["service"],
            "container_id": item["container_id"],
        } for item in before_members]

    @staticmethod
    def _intent(inputs: CapabilityInputs, observation: dict[str, Any]) -> dict[str, Any]:
        record = inputs.request["payload"].get("record_intent")
        duplicate = inputs.request["payload"].get("containment_intent")
        if record != duplicate:
            reject("ROLLBACK_FIXED_EXECUTOR_RUNTIME_CONTAINMENT_INVALID")
        return validate_runtime_containment_intent(record, inputs.request, observation)

    def contain(self, inputs: CapabilityInputs, filesystem_root: str) -> dict[str, Any]:
        request = inputs.request
        manifest = inputs.manifest
        current = self.observe(inputs)
        journal = self._journal(inputs, filesystem_root)
        events = journal.load()
        contained = self._contained_event(events)
        if contained is not None:
            if contained.get("payload", {}).get("observed") == current:
                return {"status": "CONTAINED", "output": contained["payload"]}
            return {"status": "STALE_INTENT", "output": {"observed": current}}
        started_events = [item for item in events if item["event"] == "CONTAINMENT_STARTED"]
        if len(started_events) > 1:
            reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_CHAIN_INVALID")
        if started_events:
            before = started_events[0].get("payload", {}).get("before_observed")
            if not isinstance(before, dict):
                reject("ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_CHAIN_INVALID")
            containment_intent = self._intent(inputs, before)
        else:
            before = current
            try:
                containment_intent = self._intent(inputs, before)
            except FixedExecutorError:
                return {"status": "STALE_INTENT", "output": {"observed": current}}
            journal.append(
                request, manifest["activation"]["receipt_sha256"],
                "CONTAINMENT_STARTED", {
                    "containment_intent": containment_intent,
                    "before_observed": before,
                }, self.clock(),
            )
        if not self._candidate_resources_exact(before, inputs.plan):
            reject("ROLLBACK_FIXED_EXECUTOR_RUNTIME_CONTAINMENT_INVALID")
        effects = DurableSideEffectRecorder(
            journal, request, manifest["activation"]["receipt_sha256"],
            clock=self.clock,
        )

        database_intent = effects.started_intent("DATABASE_FENCE")
        database_receipt = effects.receipt("DATABASE_FENCE")
        if database_receipt is None:
            if database_intent is None:
                database_intent = create_side_effect_intent(
                    request, "DATABASE_FENCE",
                    digest_value({
                        "database": {
                            **current["database"], "allow_connections": False,
                            "writer_sessions": 0, "sealed": True,
                        },
                    }),
                    digest_value([
                        "DOCKER_EXEC_POSTGRES_PSQL_V1",
                        inputs.plan["candidate"]["services"]["postgres"]["container_id"],
                        "postgres", "runtimeseal",
                    ]), self.clock(),
                )
                effects.begin("DATABASE_FENCE", database_intent)
            elif current["database"]["sealed"] is not True:
                raise HandlerOutcomeUnknown(
                    "SIDE_EFFECT_OUTCOME_UNKNOWN", "AFTER_SIDE_EFFECT",
                    side_effects_started=True, uncertain_action="CONTAIN",
                )
            database_before_sha256 = digest_value(current["database"])
            if current["database"]["sealed"] is True:
                database_receipt_value = create_recovered_side_effect_receipt(
                    database_intent, digest_value(before["database"]),
                    database_before_sha256, current["observation_sha256"], self.clock(),
                )
            else:
                try:
                    self.runner.postgres_runtime_seal(current["database"])
                    after_database = self.observe(inputs)
                    if after_database["database"] != {
                            **current["database"], "allow_connections": False,
                            "writer_sessions": 0, "sealed": True,
                    }:
                        reject("ROLLBACK_FIXED_EXECUTOR_RUNTIME_CONTAINMENT_INVALID")
                    database_receipt_value = create_side_effect_receipt(
                        database_intent, database_before_sha256,
                        digest_value(after_database["database"]), self.clock(),
                    )
                    current = after_database
                except HandlerOutcomeUnknown:
                    raise
                except FixedExecutorError:
                    raise HandlerOutcomeUnknown(
                        "TARGET_IDENTITY_DRIFT", "AFTER_SIDE_EFFECT",
                        side_effects_started=True, uncertain_action="CONTAIN",
                    ) from None
            effects.complete("DATABASE_FENCE", database_receipt_value)
        current = self.observe(inputs)
        if current["database"]["sealed"] is not True:
            raise HandlerOutcomeUnknown(
                "CONTAINMENT_INCOMPLETE", "CONTAINMENT",
                side_effects_started=True, uncertain_action="CONTAIN",
            )

        writer_intent = effects.started_intent("WRITER_STOP")
        writer_receipt = effects.receipt("WRITER_STOP")
        if writer_receipt is None:
            if writer_intent is None:
                writer_intent = create_side_effect_intent(
                    request, "WRITER_STOP", digest_value({
                        "writer_set_sha256":
                            current["writer_inventory"]["writer_set_sha256"],
                        "running": False,
                    }), digest_value([
                        "DOCKER_STOP_WRITER_SET_V1",
                        current["writer_inventory"]["writer_set_sha256"],
                    ]), self.clock(),
                )
                effects.begin("WRITER_STOP", writer_intent)
            elif current["writer_inventory"]["active_writer_count"] != 0:
                raise HandlerOutcomeUnknown(
                    "SIDE_EFFECT_OUTCOME_UNKNOWN", "AFTER_SIDE_EFFECT",
                    side_effects_started=True, uncertain_action="CONTAIN",
                )
            writer_before_sha256 = digest_value(current["writer_inventory"])
            running_ids = sorted(
                item["container_id"] for item in current["writer_inventory"]["members"]
                if item["running"]
            )
            if not running_ids:
                writer_receipt_value = create_recovered_side_effect_receipt(
                    writer_intent, digest_value(before["writer_inventory"]),
                    writer_before_sha256, current["observation_sha256"], self.clock(),
                )
            else:
                try:
                    self.runner.admit_runtime_writers(running_ids)
                    parse_runtime_writer_stop_ack(
                        self.runner.stop_writers(running_ids), running_ids,
                    )
                    after_writers = self.observe(inputs)
                    if after_writers["writer_inventory"]["active_writer_count"] != 0:
                        reject("ROLLBACK_FIXED_EXECUTOR_RUNTIME_CONTAINMENT_INVALID")
                    writer_receipt_value = create_side_effect_receipt(
                        writer_intent, writer_before_sha256,
                        digest_value(after_writers["writer_inventory"]), self.clock(),
                    )
                    current = after_writers
                except HandlerOutcomeUnknown:
                    raise
                except FixedExecutorError:
                    raise HandlerOutcomeUnknown(
                        "TARGET_IDENTITY_DRIFT", "AFTER_SIDE_EFFECT",
                        side_effects_started=True, uncertain_action="CONTAIN",
                    ) from None
            effects.complete("WRITER_STOP", writer_receipt_value)
        effects.assert_closed()
        after = self.observe(inputs)
        stopped_writers = self._validate_transition(before, after)
        contained_at = self.clock()
        if contained_at < containment_intent["prepared_at"]:
            reject("ROLLBACK_FIXED_EXECUTOR_RUNTIME_CONTAINMENT_INVALID")
        containment = {
            "active_generation": before["active_generation"],
            "after_observation_sha256": after["observation_sha256"],
            "after_writer_inventory_sha256": digest_value(after["writer_inventory"]),
            "before_observation_sha256": before["observation_sha256"],
            "before_writer_inventory_sha256": digest_value(before["writer_inventory"]),
            "contained_at": contained_at, "database": after["database"],
            "last_committed_record_sha256":
                containment_intent["last_committed_record_sha256"],
            "protected_resources_sha256": after["protected_resources_sha256"],
            "retained_candidate_volumes": after["retained_candidate_volumes"],
            "retained_candidate_volumes_sha256":
                digest_value(after["retained_candidate_volumes"]),
            "runtime_plan_sha256": inputs.plan["runtime_plan_sha256"],
            "stopped_writers": stopped_writers,
            "writer_set_sha256": before["writer_inventory"]["writer_set_sha256"],
        }
        containment["containment_probe_sha256"] = digest_value({
            key: value for key, value in containment.items() if key != "active_generation"
        })
        output = {"containment": containment, "observed": after}
        journal.append(
            request, manifest["activation"]["receipt_sha256"], "CONTAINED", output,
            contained_at,
        )
        return {"status": "CONTAINED", "output": output}


class ClosedWriterContainmentDriver:
    """Closed database-fence then candidate-writer-stop lifecycle."""

    def __init__(self, runner: ClosedDockerRunner, *, clock: Any = utc_now):
        self.runner = runner
        self.clock = clock

    def observe_database(
            self, spec: dict[str, Any], purpose: str, binding_sha256: str,
    ) -> dict[str, Any]:
        if not re.fullmatch(r"[a-z0-9-]{1,48}", purpose or "") \
                or not SHA256.fullmatch(binding_sha256 or ""):
            reject("ROLLBACK_FIXED_EXECUTOR_WRITER_OBSERVATION_INVALID")
        opcode = derive_writer_opcode_spec(
            spec, "PG_RB_OBSERVE_WRITER_FENCE_V1", {
                "journal_state_sha256": digest_value({
                    "writer_spec_sha256": spec["spec_sha256"],
                    "purpose": purpose, "binding_sha256": binding_sha256,
                }),
                "observation_scope_sha256": digest_value({
                    "database": spec["database"],
                    "excluded_databases": spec["excluded_databases"],
                }),
            },
        )
        return parse_writer_database_observation(
            self.runner.writer_sql_opcode(spec, opcode), spec=spec,
            observed_at=self.clock(),
        )

    def observe_services(
            self, spec: dict[str, Any], expected_status: str,
    ) -> dict[str, Any]:
        ids = sorted(item["container_id"] for item in spec["services"].values())
        return parse_writer_container_observation(
            self.runner.inspect_containers(ids), spec=spec,
            expected_status=expected_status,
        )

    def preflight(self, spec: dict[str, Any]) -> dict[str, Any]:
        spec = validate_writer_containment_spec(spec)
        services = self.observe_services(spec, "running")
        database = self.observe_database(
            spec, "preflight", services["service_set_sha256"],
        )
        if database["state"] != "INITIAL":
            reject("ROLLBACK_FIXED_EXECUTOR_WRITER_PREFLIGHT_INVALID")
        return {
            "database": database, "services": services,
            "preflight_sha256": digest_value({
                "database_observation_sha256": database["observation_sha256"],
                "service_set_sha256": services["service_set_sha256"],
            }),
        }

    def seal_database(
            self, spec: dict[str, Any], before: dict[str, Any],
    ) -> dict[str, Any]:
        if before.get("state") != "INITIAL" \
                or before.get("writer_spec_sha256") != spec.get("spec_sha256"):
            reject("ROLLBACK_FIXED_EXECUTOR_WRITER_FENCE_INVALID")
        opcode = derive_writer_opcode_spec(spec, "PG_RB_SEAL_ACTIVE_V1", {
            "before_observation_sha256": before["observation_sha256"],
            "expected_fence_sha256": digest_value({
                "database": spec["database"], "state": "SEALED",
                "runtime_plan_sha256": spec["runtime_plan_sha256"],
            }),
        })
        ack = parse_pg_mutation_ack(
            self.runner.writer_sql_opcode(spec, opcode), opcode["opcode"],
        )
        observation = self.observe_database(spec, "after-seal", ack["ack_sha256"])
        if observation["state"] != "SEALED":
            reject("ROLLBACK_FIXED_EXECUTOR_WRITER_FENCE_INVALID")
        return {"opcode": opcode, "ack": ack, "observation": observation}

    def stop_candidate_writers(
            self, spec: dict[str, Any], before: dict[str, Any],
    ) -> dict[str, Any]:
        if before.get("status") != "running" \
                or before.get("runtime_plan_sha256") != spec.get("runtime_plan_sha256"):
            reject("ROLLBACK_FIXED_EXECUTOR_WRITER_STOP_INVALID")
        ids = sorted(item["container_id"] for item in spec["services"].values())
        stop_ack_sha256 = parse_writer_stop_ack(
            self.runner.stop_writers(ids), ids,
        )
        after = self.observe_services(spec, "exited")
        before_config = {
            item["service"]: item["configuration_sha256"] for item in before["services"]
        }
        after_config = {
            item["service"]: item["configuration_sha256"] for item in after["services"]
        }
        if before_config != after_config:
            reject("ROLLBACK_FIXED_EXECUTOR_WRITER_STOP_INVALID")
        return {"stop_ack_sha256": stop_ack_sha256, "observation": after}

    def probe(self, spec: dict[str, Any], binding_sha256: str) -> dict[str, Any]:
        database = self.observe_database(spec, "recovery", binding_sha256)
        services = self.observe_services(spec, "exited")
        if database["state"] != "SEALED":
            reject("ROLLBACK_FIXED_EXECUTOR_WRITER_RECOVERY_INVALID")
        return {"database": database, "services": services}


class ClosedPostgresCapabilityDriver:
    """Closed staging-restore lifecycle over generated PostgreSQL Docker opcodes."""

    def __init__(self, runner: ClosedDockerRunner, *, clock: Any = utc_now):
        self.runner = runner
        self.clock = clock

    def observe(
            self, base: dict[str, Any], purpose: str, binding_sha256: str,
    ) -> dict[str, Any]:
        if not re.fullmatch(r"[a-z0-9-]{1,48}", purpose or "") \
                or not SHA256.fullmatch(binding_sha256 or ""):
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_OBSERVATION_INVALID")
        spec = derive_pg_opcode_spec(base, "PG_RB_OBSERVE_STATE_V1", {
            "journal_state_sha256": digest_value({
                "base_spec_sha256": base["base_spec_sha256"],
                "purpose": purpose, "binding_sha256": binding_sha256,
            }),
            "observation_scope_sha256": digest_value({
                "system_identifier": base["postgres"]["system_identifier"],
                "databases": sorted((
                    base["databases"]["active_name"],
                    base["databases"]["staging_name"],
                    base["databases"]["quarantine_name"],
                )),
            }),
        })
        raw = self.runner.postgres_sql_opcode(base, spec)
        return parse_pg_state_observation(raw, base=base, observed_at=self.clock())

    def preflight(
            self, base: dict[str, Any], dump_fd: int,
    ) -> dict[str, Any]:
        inventory = self.dump_inventory(base, dump_fd)
        observation = self.observe(base, "preflight", inventory["inventory_sha256"])
        validate_pg_pre_restore_layout(observation, base=base)
        return {
            "dump_inventory": inventory, "observation": observation,
            "preflight_sha256": digest_value({
                "dump_inventory_sha256": inventory["inventory_sha256"],
                "observation_sha256": observation["observation_sha256"],
            }),
        }

    def dump_inventory(
            self, base: dict[str, Any], dump_fd: int,
    ) -> dict[str, Any]:
        list_spec = derive_pg_dump_opcode_spec(base, "PG_RB_LIST_DUMP_V1", {
            "dump_sha256": base["snapshot"]["dump_sha256"],
            "dump_bytes": base["snapshot"]["dump_bytes"],
        })
        return parse_pg_dump_inventory(
            self.runner.postgres_dump_opcode(base, list_spec, dump_fd),
            dump_sha256=base["snapshot"]["dump_sha256"],
        )

    def create_staging(
            self, base: dict[str, Any], before_observation: dict[str, Any],
    ) -> dict[str, Any]:
        validate_pg_pre_restore_layout(before_observation, base=base)
        capacity = parse_postgres_capacity(
            self.runner.postgres_capacity(), base["snapshot"]["database_bytes"],
        )
        expected_staging_identity = digest_value({
            "name": base["databases"]["staging_name"],
            "marker": base["databases"]["staging_marker"],
            "profile_sha256": base["profile"]["profile_sha256"],
            "base_spec_sha256": base["base_spec_sha256"],
        })
        opcode = derive_pg_opcode_spec(base, "PG_RB_CREATE_STAGING_V1", {
            "capacity_receipt_sha256": capacity["capacity_sha256"],
            "before_observation_sha256": before_observation["observation_sha256"],
            "expected_staging_identity_sha256": expected_staging_identity,
        })
        ack = parse_pg_mutation_ack(
            self.runner.postgres_sql_opcode(base, opcode), opcode["opcode"],
        )
        observation = self.observe(base, "after-create", ack["ack_sha256"])
        rows = {
            item["name"]: item for item in observation["databases"]
        }
        staging = rows.get(base["databases"]["staging_name"])
        restored_oid = staging.get("oid") if isinstance(staging, dict) else None
        if not OID.fullmatch(restored_oid or "") \
                or restored_oid == base["databases"]["candidate_oid"]:
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_CREATE_RESULT_INVALID")
        classification = classify_pg_rollback_layout(
            observation, base=base, restored_oid=restored_oid,
        )
        if classification["layout"] != "OLD":
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_CREATE_RESULT_INVALID")
        return {
            "capacity": capacity, "opcode": opcode, "ack": ack,
            "observation": observation, "restored_oid": restored_oid,
            "classification": classification,
        }

    def restore_precondition(
            self, base: dict[str, Any], *, create_receipt_sha256: str,
            restored_oid: str, dump_inventory_sha256: str,
    ) -> dict[str, Any]:
        opcode = derive_pg_opcode_spec(
            base, "PG_RB_OBSERVE_STAGING_RESTORE_PRECONDITION_V1", {
                "create_receipt_sha256": create_receipt_sha256,
                "staging_oid": restored_oid,
                "dump_inventory_sha256": dump_inventory_sha256,
                "expected_empty_projection_sha256":
                    digest_value(postgres_empty_restore_projection()),
            },
        )
        proof = parse_pg_restore_precondition(
            self.runner.postgres_sql_opcode(base, opcode),
            base=base, opcode_spec=opcode,
        )
        return {"opcode": opcode, "proof": proof}

    def restore_dump(
            self, base: dict[str, Any], dump_fd: int, *, create_receipt_sha256: str,
            restored_oid: str, before_content_observation_sha256: str,
            dump_inventory_sha256: str, restore_precondition: dict[str, Any],
    ) -> dict[str, Any]:
        precondition_opcode = derive_pg_opcode_spec(
            base, "PG_RB_OBSERVE_STAGING_RESTORE_PRECONDITION_V1", {
                "create_receipt_sha256": create_receipt_sha256,
                "staging_oid": restored_oid,
                "dump_inventory_sha256": dump_inventory_sha256,
                "expected_empty_projection_sha256":
                    digest_value(postgres_empty_restore_projection()),
            },
        )
        precondition = validate_pg_restore_precondition_proof(
            restore_precondition, base=base, opcode_spec=precondition_opcode,
        )
        opcode = derive_pg_dump_opcode_spec(base, "PG_RB_RESTORE_DUMP_V1", {
            "create_receipt_sha256": create_receipt_sha256,
            "staging_oid": restored_oid,
            "before_content_observation_sha256": before_content_observation_sha256,
            "dump_inventory_sha256": dump_inventory_sha256,
            "restore_precondition_opcode_spec_sha256":
                precondition_opcode["opcode_spec_sha256"],
            "restore_precondition_sha256":
                precondition["restore_precondition_sha256"],
            "empty_projection_sha256": precondition["empty_projection_sha256"],
            "dump_sha256": base["snapshot"]["dump_sha256"],
            "dump_bytes": base["snapshot"]["dump_bytes"],
            "expected_content_sha256":
                base["snapshot"]["target_database_report_sha256"],
        })
        ack = parse_pg_mutation_ack(
            self.runner.postgres_dump_opcode(base, opcode, dump_fd), opcode["opcode"],
        )
        return {
            "opcode": opcode, "ack": ack, "restored_oid": restored_oid,
            "restore_precondition": precondition,
        }

    def reconcile(
            self, base: dict[str, Any], inputs: CapabilityInputs, *,
            restore_receipt_sha256: str, restored_oid: str,
    ) -> dict[str, Any]:
        try:
            authority_activation_sha256 = \
                inputs.package["sources"]["snapshot_policy_activation"]["sha256"]
        except (KeyError, TypeError):
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_RECONCILIATION_INVALID")
        opcode = derive_pg_reconcile_opcode_spec(base, inputs, {
            "restore_receipt_sha256": restore_receipt_sha256,
            "staging_oid": restored_oid,
            "baseline_security_sha256": digest_value({
                "security": base["security"], "phase": "BEFORE_RECONCILIATION",
            }),
            "authority_activation_sha256": authority_activation_sha256,
            "desired_sealed_security_sha256": digest_value(base["security"]),
        })
        ack = parse_pg_mutation_ack(
            self.runner.postgres_reconcile_opcode(base, inputs, opcode), opcode["opcode"],
        )
        observation = self.observe(base, "after-reconcile", ack["ack_sha256"])
        classification = classify_pg_rollback_layout(
            observation, base=base, restored_oid=restored_oid,
        )
        if classification["layout"] != "OLD":
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_RECONCILIATION_INVALID")
        return {
            "opcode": opcode, "ack": ack, "observation": observation,
            "classification": classification, "restored_oid": restored_oid,
        }

    def prove_staging_content(
            self, inputs: CapabilityInputs, base: dict[str, Any], *,
            restored_oid: str, binding_sha256: str,
    ) -> dict[str, Any]:
        code = "ROLLBACK_FIXED_EXECUTOR_STAGING_CONTENT_PROOF_INVALID"
        base = validate_pg_rollback_base_spec(base)
        if OID.fullmatch(restored_oid or "") is None \
                or SHA256.fullmatch(binding_sha256 or "") is None:
            reject(code)
        inputs.fd("snapshot_postgresql")
        source_report = snapshot_database_reconciliation(inputs, base)
        source_migrations = inputs.raw("snapshot_migrations")
        migration = validate_migration_ledger(
            source_migrations,
            expected_ledger_file_sha256=
                base["snapshot"]["migration_ledger_file_sha256"],
            expected_allowlist_sha256=
                base["snapshot"]["migration_allowlist_sha256"],
            expected_head=base["snapshot"]["migration_head"],
        )
        before = self.observe(base, "preswitch-before", binding_sha256)
        if classify_pg_rollback_layout(
                before, base=base, restored_oid=restored_oid,
        )["layout"] != "OLD":
            reject(code)
        live_report = validate_database_reconciliation_report(
            self.runner.postgres_preswitch_content(base),
        )
        if live_report["sha256"] != source_report["report_sha256"]:
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_CONTENT_DRIFT")
        live_migrations = self.runner.postgres_postverify_migrations(
            base["databases"]["staging_name"], sealed_staging=True,
        )
        live_migration = validate_migration_ledger(
            live_migrations,
            expected_ledger_file_sha256=
                base["snapshot"]["migration_ledger_file_sha256"],
            expected_allowlist_sha256=
                base["snapshot"]["migration_allowlist_sha256"],
            expected_head=base["snapshot"]["migration_head"],
        )
        if live_migrations != source_migrations or live_migration != migration:
            reject("ROLLBACK_FIXED_EXECUTOR_MIGRATION_LEDGER_DRIFT")
        security = parse_runtime_privilege_state(
            self.runner.postgres_preswitch_security(base, inputs),
            inputs=inputs, base=base, target={
                "database_oid": restored_oid, "mode": "SEALED_STAGING",
                "database_name": base["databases"]["staging_name"],
                "marker": base["databases"]["staging_marker"],
                "connection_limit": 0,
            },
        )
        sessions = parse_postgres_session_observation(
            self.runner.postgres_postverify_sessions(
                base["databases"]["staging_name"], sealed_staging=True,
            ),
            database=base["databases"]["staging_name"], allowed_clients={},
        )
        identity = parse_postgres_database_identity(
            self.runner.postgres_postverify_identity(
                base["databases"]["staging_name"], sealed_staging=True,
            ),
            expected_connection_limit=0,
            expected_default_transaction_read_only=True,
        )
        expected_identity = {
            "name": base["databases"]["staging_name"],
            "system_identifier": base["postgres"]["system_identifier"],
            "oid": restored_oid, "marker": base["databases"]["staging_marker"],
        }
        if any(identity[field] != expected_value
               for field, expected_value in expected_identity.items()):
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_IDENTITY_DRIFT")
        after_binding = digest_value({
            "binding_sha256": binding_sha256,
            "content_sha256": live_report["sha256"],
            "migration_ledger_sha256": live_migration["ledger_sha256"],
            "security_state_sha256": security["state_sha256"],
            "session_observation_sha256": sessions["observation_sha256"],
            "database_identity_sha256": identity["identity_sha256"],
        })
        after = self.observe(base, "preswitch-after", after_binding)
        if classify_pg_rollback_layout(
                after, base=base, restored_oid=restored_oid,
        )["layout"] != "OLD":
            reject(code)
        before_rows = {item["name"]: item for item in before["databases"]}
        after_rows = {item["name"]: item for item in after["databases"]}
        target = after_rows.get(base["databases"]["staging_name"])
        candidate = after_rows.get(base["databases"]["active_name"])
        before_target = before_rows.get(base["databases"]["staging_name"])
        if not isinstance(target, dict) or not isinstance(candidate, dict) \
                or not isinstance(before_target, dict) \
                or sessions["total"] != 0 or before_target["sessions"] != 0 \
                or target["sessions"] != 0:
            reject(code)
        return {
            "source_report": source_report, "live_report": live_report,
            "migration": migration, "security": security, "sessions": sessions,
            "identity": identity, "before": before, "after": after,
            "target": target, "candidate": candidate,
        }

    def guarded_switch_opcode(
            self, base: dict[str, Any], inputs: CapabilityInputs, *,
            privilege_receipt_sha256: str,
            staging_content_proof_sha256: str, restored_oid: str,
            before_observation_sha256: str,
    ) -> dict[str, Any]:
        """Derive the exact guarded-switch command before its durable intent."""
        base = validate_pg_rollback_base_spec(base)
        if OID.fullmatch(restored_oid or "") is None \
                or any(SHA256.fullmatch(value or "") is None
                       for value in (
                           privilege_receipt_sha256,
                           staging_content_proof_sha256,
                           before_observation_sha256,
                       )):
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_GUARDED_SWITCH_INVALID")
        material = _postgres_guarded_switch_material(
            base, inputs, restored_oid=restored_oid,
        )
        source_bindings = {
            "source_reconciliation_sha256":
                base["snapshot"]["source_reconciliation_sha256"],
            "expected_content_report_sha256": material["report"]["sha256"],
            "migration_ledger_file_sha256":
                material["migration"]["ledger_file_sha256"],
            "migration_allowlist_sha256": material["migration"]["allowlist_sha256"],
            "expected_security_state_sha256": material["security_state_sha256"],
        }
        bindings = {
            "privilege_receipt_sha256": privilege_receipt_sha256,
            "staging_oid": restored_oid,
            "before_observation_sha256": before_observation_sha256,
            "staging_content_proof_sha256": staging_content_proof_sha256,
            "expected_switched_identity_sha256": digest_value({
                "active_name": base["databases"]["active_name"],
                "active_oid": restored_oid,
                "quarantine_name": base["databases"]["quarantine_name"],
                "quarantine_oid": base["databases"]["candidate_oid"],
                "state": "NEW_SEALED",
            }),
            **source_bindings,
            "guarded_state_sha256": digest_value({
                **source_bindings,
                "staging_content_proof_sha256": staging_content_proof_sha256,
                "staging_oid": restored_oid,
            }),
        }
        return derive_pg_guarded_switch_opcode_spec(
            base, inputs, bindings,
        )

    def execute_guarded_switch(
            self, base: dict[str, Any], inputs: CapabilityInputs, *,
            opcode: dict[str, Any], restored_oid: str,
    ) -> dict[str, Any]:
        """Execute one already-bound guarded command and prove its final layout."""
        base = validate_pg_rollback_base_spec(base)
        opcode = validate_pg_guarded_switch_opcode_spec(
            opcode, base=base, inputs=inputs,
        )
        if opcode["bindings"]["staging_oid"] != restored_oid:
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_GUARDED_SWITCH_INVALID")
        ack = parse_pg_mutation_ack(
            self.runner.postgres_guarded_switch_opcode(base, inputs, opcode),
            opcode["opcode"],
        )
        observation = self.observe(base, "after-switch", ack["ack_sha256"])
        classification = classify_pg_rollback_layout(
            observation, base=base, restored_oid=restored_oid,
        )
        if classification["layout"] != "NEW_SEALED":
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_SWITCH_RESULT_INVALID")
        return {
            "opcode": opcode, "ack": ack, "observation": observation,
            "classification": classification, "restored_oid": restored_oid,
        }

    def switch(
            self, base: dict[str, Any], inputs: CapabilityInputs, *,
            privilege_receipt_sha256: str,
            staging_content_proof_sha256: str, restored_oid: str,
            before_observation: dict[str, Any],
    ) -> dict[str, Any]:
        before = classify_pg_rollback_layout(
            before_observation, base=base, restored_oid=restored_oid,
        )
        if before["layout"] != "OLD":
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_SWITCH_RESULT_INVALID")
        opcode = self.guarded_switch_opcode(
            base, inputs,
            privilege_receipt_sha256=privilege_receipt_sha256,
            staging_content_proof_sha256=staging_content_proof_sha256,
            restored_oid=restored_oid,
            before_observation_sha256=before_observation["observation_sha256"],
        )
        return self.execute_guarded_switch(
            base, inputs, opcode=opcode, restored_oid=restored_oid,
        )

    def unseal(
            self, base: dict[str, Any], *, switch_receipt_sha256: str,
            activation_prerequisites_sha256: str,
            sealed_security_projection_sha256: str, restored_oid: str,
            before_observation: dict[str, Any],
    ) -> dict[str, Any]:
        before = classify_pg_rollback_layout(
            before_observation, base=base, restored_oid=restored_oid,
        )
        if before["layout"] != "NEW_SEALED":
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_UNSEAL_RESULT_INVALID")
        opcode = derive_pg_opcode_spec(base, "PG_RB_UNSEAL_ACTIVE_V1", {
            "switch_receipt_sha256": switch_receipt_sha256,
            "active_oid": restored_oid,
            "activation_prerequisites_sha256": activation_prerequisites_sha256,
            "sealed_security_projection_sha256": sealed_security_projection_sha256,
            "before_observation_sha256": before_observation["observation_sha256"],
            "expected_released_identity_sha256": digest_value({
                "active_name": base["databases"]["active_name"],
                "active_oid": restored_oid,
                "quarantine_name": base["databases"]["quarantine_name"],
                "quarantine_oid": base["databases"]["candidate_oid"],
                "state": "NEW_RELEASED",
            }),
        })
        ack = parse_pg_mutation_ack(
            self.runner.postgres_sql_opcode(base, opcode), opcode["opcode"],
        )
        observation = self.observe(base, "after-unseal", ack["ack_sha256"])
        classification = classify_pg_rollback_layout(
            observation, base=base, restored_oid=restored_oid,
        )
        if classification["layout"] != "NEW_RELEASED":
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_UNSEAL_RESULT_INVALID")
        return {
            "opcode": opcode, "ack": ack, "observation": observation,
            "classification": classification, "restored_oid": restored_oid,
        }

    def postverify_content(
            self, inputs: CapabilityInputs, base: dict[str, Any], *,
            restored_oid: str, binding_sha256: str,
            require_zero_writer_sessions: bool = False,
    ) -> dict[str, Any]:
        """Read the released database through independent, fixed postverify opcodes."""
        code = "ROLLBACK_FIXED_EXECUTOR_POSTGRES_POSTVERIFY_INVALID"
        base = validate_pg_rollback_base_spec(base)
        if not OID.fullmatch(restored_oid or "") \
                or not SHA256.fullmatch(binding_sha256 or "") \
                or not isinstance(require_zero_writer_sessions, bool):
            reject(code)
        inputs.fd("snapshot_postgresql")
        source_report = snapshot_database_reconciliation(inputs, base)
        source_migrations = inputs.raw("snapshot_migrations")
        migration = validate_migration_ledger(
            source_migrations,
            expected_ledger_file_sha256=
                base["snapshot"]["migration_ledger_file_sha256"],
            expected_allowlist_sha256=
                base["snapshot"]["migration_allowlist_sha256"],
            expected_head=base["snapshot"]["migration_head"],
        )
        before = self.observe(base, "postverify-before", binding_sha256)
        before_classification = classify_pg_rollback_layout(
            before, base=base, restored_oid=restored_oid,
        )
        if before_classification["layout"] != "NEW_RELEASED":
            reject(code)
        live_report = self.runner.postgres_postverify_content(base)
        live_report_evidence = validate_database_reconciliation_report(live_report)
        if live_report_evidence["sha256"] != source_report["report_sha256"]:
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_CONTENT_DRIFT")
        live_migrations = self.runner.postgres_postverify_migrations(
            base["databases"]["active_name"],
        )
        live_migration = validate_migration_ledger(
            live_migrations,
            expected_ledger_file_sha256=
                base["snapshot"]["migration_ledger_file_sha256"],
            expected_allowlist_sha256=
                base["snapshot"]["migration_allowlist_sha256"],
            expected_head=base["snapshot"]["migration_head"],
        )
        if live_migrations != source_migrations or live_migration != migration:
            reject("ROLLBACK_FIXED_EXECUTOR_MIGRATION_LEDGER_DRIFT")
        security = parse_runtime_privilege_state(
            self.runner.postgres_postverify_security(base, inputs),
            inputs=inputs, base=base, restored_oid=restored_oid,
        )
        try:
            policy = inputs.json("snapshot_runtime_privilege_policy")
            allowed_clients = {
                policy["service_bindings"][service]["login"]: {
                    "application_name": RUNTIME_WRITER_SESSION_CLIENTS[service][
                        "application_name"
                    ],
                    "pool_maximum": RUNTIME_WRITER_SESSION_CLIENTS[service]["pool_maximum"],
                }
                for service in ("WEB", "WORKER")
            }
            allowed_clients = dict(sorted(allowed_clients.items()))
            if any(
                    policy["service_bindings"][service]["login"]
                    != RUNTIME_WRITER_SESSION_CLIENTS[service]["role"]
                    for service in ("WEB", "WORKER")
            ):
                reject(code)
        except (KeyError, TypeError):
            reject(code)
        sessions = parse_postgres_session_observation(
            self.runner.postgres_postverify_sessions(
                base["databases"]["active_name"],
            ),
            database=base["databases"]["active_name"],
            allowed_clients=allowed_clients,
        )
        identity = parse_postgres_database_identity(
            self.runner.postgres_postverify_identity(
                base["databases"]["active_name"],
            ),
        )
        expected_identity = {
            "name": base["databases"]["active_name"],
            "system_identifier": base["postgres"]["system_identifier"],
            "oid": restored_oid,
            "marker": base["databases"]["candidate_marker"],
        }
        if any(identity[field] != value for field, value in expected_identity.items()):
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_IDENTITY_DRIFT")
        after_binding = digest_value({
            "binding_sha256": binding_sha256,
            "content_sha256": live_report_evidence["sha256"],
            "migration_ledger_sha256": live_migration["ledger_sha256"],
            "security_state_sha256": security["state_sha256"],
            "session_observation_sha256": sessions["observation_sha256"],
            "database_identity_sha256": identity["identity_sha256"],
        })
        after = self.observe(base, "postverify-after", after_binding)
        after_classification = classify_pg_rollback_layout(
            after, base=base, restored_oid=restored_oid,
        )
        if after_classification["layout"] != "NEW_RELEASED":
            reject(code)
        rows = {item["name"]: item for item in after["databases"]}
        before_rows = {item["name"]: item for item in before["databases"]}
        active = rows.get(base["databases"]["active_name"])
        quarantine = rows.get(base["databases"]["quarantine_name"])
        before_active = before_rows.get(base["databases"]["active_name"])
        if not isinstance(active, dict) or not isinstance(quarantine, dict) \
                or not isinstance(before_active, dict):
            reject(code)
        if require_zero_writer_sessions \
                and (sessions["total"] != 0 or before_active["sessions"] != 0
                     or active["sessions"] != 0):
            reject("ROLLBACK_FIXED_EXECUTOR_PREACTIVATION_WRITER_SESSION_PRESENT")
        return {
            "source_report": source_report, "live_report": live_report_evidence,
            "migration": migration, "security": security, "sessions": sessions,
            "identity": identity, "before": before, "after": after,
            "active": active, "quarantine": quarantine,
        }

    def postverify_migration_head(
            self, inputs: CapabilityInputs, *, database: str, restored_oid: str,
            system_identifier: str, marker: str, expected_head: str,
            expected_ledger_file_sha256: str, expected_allowlist_sha256: str,
    ) -> dict[str, Any]:
        code = "ROLLBACK_FIXED_EXECUTOR_MIGRATION_HEAD_INVALID"
        if database != inputs.plan["targets"]["database"]["active"] \
                or OID.fullmatch(restored_oid or "") is None \
                or SYSTEM_IDENTIFIER.fullmatch(system_identifier or "") is None \
                or marker != "chenyida-erp-deployment/v2:UAT:chenyida-erp":
            reject(code)
        validate_predecessor_migration_binding(
            inputs, expected_head=expected_head,
            expected_sha256=expected_allowlist_sha256,
        )
        source = inputs.raw("snapshot_migrations")
        source_ledger = validate_migration_ledger(
            source, expected_ledger_file_sha256=expected_ledger_file_sha256,
            expected_allowlist_sha256=expected_allowlist_sha256,
            expected_head=expected_head,
        )
        live = self.runner.postgres_postverify_migrations(database)
        live_ledger = validate_migration_ledger(
            live, expected_ledger_file_sha256=expected_ledger_file_sha256,
            expected_allowlist_sha256=expected_allowlist_sha256,
            expected_head=expected_head,
        )
        identity = parse_postgres_database_identity(
            self.runner.postgres_postverify_identity(database),
        )
        if source != live or source_ledger != live_ledger \
                or identity["name"] != database or identity["oid"] != restored_oid \
                or identity["system_identifier"] != system_identifier \
                or identity["marker"] != marker:
            reject(code)
        return {"migration": live_ledger, "identity": identity}


class ClosedActivationCapabilityDriver:
    """Closed unseal, pinned Compose activation and exact runtime observation."""

    def __init__(
            self, docker_runner: ClosedDockerRunner,
            postgres_driver: ClosedPostgresCapabilityDriver,
            compose_runner: "ClosedComposeRunner",
    ):
        self.docker_runner = docker_runner
        self.postgres_driver = postgres_driver
        self.compose_runner = compose_runner

    def preflight(
            self, inputs: CapabilityInputs, base: dict[str, Any], *,
            restored_oid: str, binding_sha256: str,
    ) -> dict[str, Any]:
        plan = inputs.plan
        images = {}
        for service in ("web", "worker"):
            reference = plan["predecessor"][f"{service}_image"]
            config = plan["predecessor"][f"{service}_image_config_digest"]
            images[service] = parse_predecessor_image_observation(
                self.docker_runner.inspect_image(reference),
                image_reference=reference, image_config_digest=config,
            )
        database = self.postgres_driver.observe(
            base, "activation-preflight", binding_sha256,
        )
        classification = classify_pg_rollback_layout(
            database, base=base, restored_oid=restored_oid,
        )
        if classification["layout"] != "NEW_SEALED":
            reject("ROLLBACK_FIXED_EXECUTOR_ACTIVATION_PREFLIGHT_INVALID")
        for role in ("deployment_environment", "compose_file", "compose_release_file"):
            inputs.fd(role, maximum_bytes=4 * 1024 * 1024)
        return {
            "images": images, "database": database,
            "classification": classification,
            "preflight_sha256": digest_value({
                "image_observations": {
                    name: item["image_observation_sha256"] for name, item in images.items()
                },
                "database_observation_sha256": database["observation_sha256"],
            }),
        }

    def unseal(
            self, base: dict[str, Any], stage_evidence: dict[str, Any], *,
            activation_prerequisites_sha256: str,
            before_observation: dict[str, Any],
    ) -> dict[str, Any]:
        return self.postgres_driver.unseal(
            base,
            switch_receipt_sha256=stage_evidence["switch_receipt_sha256"],
            activation_prerequisites_sha256=activation_prerequisites_sha256,
            sealed_security_projection_sha256=
                stage_evidence["sealed_security_projection_sha256"],
            restored_oid=stage_evidence["restored_database_oid"],
            before_observation=before_observation,
        )

    def probe_database(
            self, base: dict[str, Any], *, restored_oid: str, binding_sha256: str,
    ) -> dict[str, Any]:
        observation = self.postgres_driver.observe(
            base, "recover-unseal", binding_sha256,
        )
        classification = classify_pg_rollback_layout(
            observation, base=base, restored_oid=restored_oid,
        )
        if classification["layout"] != "NEW_RELEASED":
            reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_UNSEAL_RESULT_INVALID")
        return {"observation": observation, "classification": classification}

    def prove_content(
            self, inputs: CapabilityInputs, base: dict[str, Any], *,
            restored_oid: str, binding_sha256: str,
    ) -> dict[str, Any]:
        observed = self.postgres_driver.postverify_content(
            inputs, base, restored_oid=restored_oid,
            binding_sha256=binding_sha256, require_zero_writer_sessions=True,
        )
        return build_preactivation_content_proof(observed, base, binding_sha256)

    def observe_services(self, plan: dict[str, Any]) -> dict[str, Any]:
        identifiers = parse_project_container_discovery(
            self.docker_runner.discover_project_containers(),
        )
        self.docker_runner.register_discovered_containers(identifiers)
        observation = parse_activation_service_observation(
            self.docker_runner.inspect_containers(identifiers),
            plan=plan, discovered_ids=identifiers,
        )
        writers = [
            item["container_id"] for item in observation["services"]
            if item["service"] in {"web", "worker"}
        ]
        self.docker_runner.admit_predecessor_writers(writers)
        return observation

    def observe_readiness(self, services: dict[str, Any]) -> dict[str, Any]:
        web = next(
            (item for item in services.get("services", []) if item.get("service") == "web"),
            None,
        )
        if not isinstance(web, dict):
            reject("ROLLBACK_FIXED_EXECUTOR_HEALTH_CONTAINER_INVALID")
        return parse_health_readiness_response(
            self.docker_runner.inspect_web_readiness(web["container_id"]),
        )

    def activate(self, inputs: CapabilityInputs) -> dict[str, Any]:
        compose_receipt = self.compose_runner.activate_predecessor_writers(
            inputs.fd("deployment_environment", maximum_bytes=4 * 1024 * 1024),
            inputs.fd("compose_file", maximum_bytes=4 * 1024 * 1024),
            inputs.fd("compose_release_file", maximum_bytes=4 * 1024 * 1024),
        )
        services = self.observe_services(inputs.plan)
        readiness = self.observe_readiness(services)
        return {
            "compose_receipt": compose_receipt, "services": services,
            "readiness": readiness,
        }

    def probe(
            self, inputs: CapabilityInputs, base: dict[str, Any], *,
            restored_oid: str, binding_sha256: str,
    ) -> dict[str, Any]:
        database = self.postgres_driver.observe(base, "activation-recovery", binding_sha256)
        classification = classify_pg_rollback_layout(
            database, base=base, restored_oid=restored_oid,
        )
        if classification["layout"] != "NEW_RELEASED":
            reject("ROLLBACK_FIXED_EXECUTOR_ACTIVATION_RECOVERY_INVALID")
        services = self.observe_services(inputs.plan)
        return {
            "database": database, "classification": classification,
            "services": services, "readiness": self.observe_readiness(services),
        }


class ClosedProtectedResourceDriver:
    """Read-only proof that protected candidate resources survived rollback unchanged."""

    def __init__(self, runner: ClosedDockerRunner):
        self.runner = runner

    def observe(
            self, inputs: CapabilityInputs,
            volume_evidence: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        plan = inputs.plan
        identifiers = parse_project_container_discovery(
            self.runner.discover_project_containers(),
        )
        self.runner.register_discovered_containers(identifiers)
        services = parse_activation_service_observation(
            self.runner.inspect_containers(identifiers),
            plan=plan, discovered_ids=identifiers,
        )
        volumes: dict[str, dict[str, str]] = {}
        for domain in ("uploads", "attachments", "backup_status"):
            candidate = plan["candidate"]["volumes"][domain]
            target = plan["targets"]["volumes"][domain]
            stage = volume_evidence[domain]
            if not self.runner.parse_volume_discovery(
                    self.runner.discover_volume(candidate["name"]), candidate["name"],
            ) or not self.runner.parse_volume_discovery(
                    self.runner.discover_volume(target["target"]), target["target"],
            ):
                reject("ROLLBACK_FIXED_EXECUTOR_PROTECTED_RESOURCE_INVALID")
            candidate_observation = parse_volume_inspection(
                self.runner.inspect_volumes([candidate["name"]]), candidate["name"],
            )
            binding = {
                "source_artifact_sha256": stage["source_artifact_sha256"],
                "source_reconciliation_sha256": stage["source_reconciliation_sha256"],
                "expected_tree_sha256": stage["expected_tree_sha256"],
                "marker_sha256": stage["target_volume_marker_sha256"],
            }
            target_observation = parse_volume_inspection(
                self.runner.inspect_volumes([target["target"]]), target["target"],
                expected_labels=self.runner.derived_volume_labels(domain, binding),
            )
            if candidate_observation["identity_sha256"] != candidate["identity_sha256"] \
                    or target_observation["identity_sha256"] \
                        != stage["target_volume_identity_sha256"] \
                    or target_observation["identity_sha256"] \
                        == candidate_observation["identity_sha256"] \
                    or self.runner.register_volume_utility_discovery(
                        domain, self.runner.discover_volume_utility(domain),
                    ) is not None:
                reject("ROLLBACK_FIXED_EXECUTOR_PROTECTED_RESOURCE_INVALID")
            volumes[domain] = {
                "candidate_identity_sha256": candidate_observation["identity_sha256"],
                "target_identity_sha256": target_observation["identity_sha256"],
                "target_labels_sha256": digest_value(target_observation["labels"]),
            }
        body = {
            "schema_version": 1,
            "contract": "chenyida-erp-uat-rollback-protected-resource-observation/v1",
            "runtime_plan_sha256": plan["runtime_plan_sha256"],
            "protected_resources_sha256": plan["candidate"]["protected_resources_sha256"],
            "service_set_sha256": services["service_set_sha256"],
            "volumes": volumes,
        }
        return {**body, "observation_sha256": digest_value(body)}


class ClosedServiceIdentityDriver:
    """Complete-project read-only service identity observation."""

    def __init__(self, runner: ClosedDockerRunner):
        self.runner = runner

    def observe(self, inputs: CapabilityInputs) -> dict[str, Any]:
        identifiers = parse_project_container_discovery(
            self.runner.discover_project_containers(),
        )
        self.runner.register_discovered_containers(identifiers)
        return parse_activation_service_observation(
            self.runner.inspect_containers(identifiers),
            plan=inputs.plan, discovered_ids=identifiers,
        )


class ClosedHealthCapabilityDriver:
    """One current runtime snapshot plus independent readiness and mounted identity reads."""

    def __init__(self, runner: ClosedDockerRunner):
        self.runner = runner

    def observe(self, inputs: CapabilityInputs) -> dict[str, Any]:
        identifiers = parse_project_container_discovery(
            self.runner.discover_project_containers(),
        )
        self.runner.register_discovered_containers(identifiers)
        services = parse_activation_service_observation(
            self.runner.inspect_containers(identifiers),
            plan=inputs.plan, discovered_ids=identifiers,
        )
        writers = [
            item["container_id"] for item in services["services"]
            if item["service"] in {"web", "worker"}
        ]
        self.runner.admit_predecessor_writers(writers)
        web = next(
            (item for item in services["services"] if item["service"] == "web"),
            None,
        )
        if web is None:
            reject("ROLLBACK_FIXED_EXECUTOR_HEALTH_CONTAINER_INVALID")
        return {
            "services": services,
            "readiness": parse_health_readiness_response(
                self.runner.inspect_web_readiness(web["container_id"]),
            ),
            "mounted_release_identity": self.runner.read_mounted_release_identity(
                web["container_id"],
            ),
        }


class ClosedVolumeCapabilityDriver:
    """High-level closed lifecycle for one isolated helper container at a time."""

    def __init__(self, runner: ClosedDockerRunner):
        self.runner = runner

    def _admit_helper(self) -> str:
        if self.runner.volume_helper_admission_sha256 is None:
            observed = self.runner.inspect_volume_helper_image()
            return self.runner.admit_volume_helper_image(observed)
        return self.runner.volume_helper_admission_sha256

    def _volume(self, name: str, expected_labels: dict[str, str] | None = None) -> dict[str, Any]:
        return parse_volume_inspection(
            self.runner.inspect_volumes([name]), name, expected_labels=expected_labels,
        )

    def _present(self, name: str) -> bool:
        return self.runner.parse_volume_discovery(
            self.runner.discover_volume(name), name,
        )

    def preflight(self, spec: dict[str, Any], *, target_present: bool) -> dict[str, Any]:
        helper_admission = self._admit_helper()
        if not self._present(spec["candidate_volume"]):
            reject("ROLLBACK_FIXED_EXECUTOR_CANDIDATE_VOLUME_MISSING")
        candidate = self._volume(spec["candidate_volume"])
        if candidate["identity_sha256"] != spec["candidate_volume_identity_sha256"]:
            reject("ROLLBACK_FIXED_EXECUTOR_CANDIDATE_VOLUME_IDENTITY_DRIFT")
        observed_target = self._present(spec["target_volume"])
        if observed_target is not target_present:
            reject("ROLLBACK_FIXED_EXECUTOR_TARGET_VOLUME_STATE_INVALID")
        if self.runner.register_volume_utility_discovery(
                spec["domain"], self.runner.discover_volume_utility(spec["domain"])) is not None:
            reject("ROLLBACK_FIXED_EXECUTOR_VOLUME_UTILITY_STATE_INVALID")
        return {
            "helper_image_admission_sha256": helper_admission,
            "candidate_volume_identity_sha256": candidate["identity_sha256"],
            "target_present": observed_target,
        }

    @staticmethod
    def marker(spec: dict[str, Any]) -> dict[str, Any]:
        body = {
            "schema_version": 1,
            "contract": "chenyida-erp-uat-promotion-rollback-volume-target-marker/v1",
            "domain": spec["domain"], "target_volume": spec["target_volume"],
            "source_artifact_sha256": spec["source_artifact_sha256"],
            "source_reconciliation_sha256": spec["source_reconciliation_sha256"],
            "expected_tree_sha256": spec["expected_tree_sha256"],
            "metadata_policy_sha256": spec["metadata_policy_sha256"],
            "runtime_plan_sha256": spec["runtime_plan_sha256"],
        }
        return {**body, "marker_sha256": digest_value(body)}

    def create_target(self, spec: dict[str, Any]) -> dict[str, Any]:
        marker = self.marker(spec)
        binding = {
            "source_artifact_sha256": spec["source_artifact_sha256"],
            "source_reconciliation_sha256": spec["source_reconciliation_sha256"],
            "expected_tree_sha256": spec["expected_tree_sha256"],
            "marker_sha256": marker["marker_sha256"],
        }
        output = self.runner.create_derived_volume(spec["domain"], binding)
        if output != f"{spec['target_volume']}\n".encode("utf-8"):
            raise HandlerOutcomeUnknown(
                "SIDE_EFFECT_OUTCOME_UNKNOWN", "AFTER_SIDE_EFFECT",
                side_effects_started=True,
            )
        labels = self.runner.derived_volume_labels(spec["domain"], binding)
        target = self._volume(spec["target_volume"], labels)
        if target["identity_sha256"] == spec["candidate_volume_identity_sha256"]:
            reject("ROLLBACK_FIXED_EXECUTOR_TARGET_VOLUME_IDENTITY_INVALID")
        return {
            "target_volume_identity_sha256": target["identity_sha256"],
            "target_volume_marker_sha256": marker["marker_sha256"],
            "target_labels_sha256": digest_value(labels),
        }

    def observe_target(self, spec: dict[str, Any], expected_identity_sha256: str) -> dict[str, Any]:
        marker = self.marker(spec)
        binding = {
            "source_artifact_sha256": spec["source_artifact_sha256"],
            "source_reconciliation_sha256": spec["source_reconciliation_sha256"],
            "expected_tree_sha256": spec["expected_tree_sha256"],
            "marker_sha256": marker["marker_sha256"],
        }
        if not self._present(spec["target_volume"]):
            reject("ROLLBACK_FIXED_EXECUTOR_TARGET_VOLUME_STATE_INVALID")
        target = self._volume(
            spec["target_volume"], self.runner.derived_volume_labels(spec["domain"], binding),
        )
        if target["identity_sha256"] != expected_identity_sha256:
            reject("ROLLBACK_FIXED_EXECUTOR_TARGET_VOLUME_IDENTITY_DRIFT")
        return {
            "target_volume_identity_sha256": target["identity_sha256"],
            "target_volume_marker_sha256": marker["marker_sha256"],
        }

    def _create_and_admit(
            self, spec: dict[str, Any], opcode: str, arguments: list[str] | None = None,
    ) -> str:
        identifier = self.runner.create_volume_utility(spec["domain"], opcode, arguments)
        observed = self.runner.inspect_volume_utility(spec["domain"])
        self.runner.admit_volume_utility(spec["domain"], observed)
        return identifier

    def _verify_exit(self, spec: dict[str, Any]) -> str:
        return self.runner.verify_volume_utility_exited(
            spec["domain"], self.runner.inspect_volume_utility(spec["domain"]),
        )

    def remove_utility(self, spec: dict[str, Any]) -> str:
        self.runner.remove_volume_utility(spec["domain"])
        return self.runner.verify_volume_utility_removed(
            spec["domain"], self.runner.discover_volume_utility(spec["domain"]),
        )

    def capacity(self, spec: dict[str, Any]) -> dict[str, Any]:
        identifier = self._create_and_admit(spec, "capacity")
        output = self.runner.volume_capacity(spec["domain"])
        exited = self._verify_exit(spec)
        removed = self.remove_utility(spec)
        return {
            "container_id": identifier, "observation": parse_gnu_df_capacity(output),
            "exited_identity_sha256": exited, "removed_identity_sha256": removed,
        }

    def restore(self, spec: dict[str, Any], archive_fd: int) -> dict[str, Any]:
        identifier = self._create_and_admit(spec, "restore")
        output = self.runner.restore_volume_archive(
            spec["domain"], archive_fd, spec["source_artifact_sha256"],
        )
        if output != b"":
            raise HandlerOutcomeUnknown(
                "SIDE_EFFECT_OUTCOME_UNKNOWN", "AFTER_SIDE_EFFECT",
                side_effects_started=True,
            )
        exited = self._verify_exit(spec)
        removed = self.remove_utility(spec)
        return {
            "container_id": identifier, "exited_identity_sha256": exited,
            "removed_identity_sha256": removed,
        }

    def reconcile(self, spec: dict[str, Any]) -> dict[str, Any]:
        domain = spec["domain"]
        opcode = f"reconcile-{domain.replace('_', '-')}"
        arguments = [str(spec["backup_status_reader_gid"])] \
            if domain == "backup_status" else None
        identifier = self._create_and_admit(spec, opcode, arguments)
        output = self.runner.reconcile_volume_metadata(
            domain, spec["backup_status_reader_gid"] if domain == "backup_status" else None,
        )
        if output != b"":
            raise HandlerOutcomeUnknown(
                "SIDE_EFFECT_OUTCOME_UNKNOWN", "AFTER_SIDE_EFFECT",
                side_effects_started=True,
            )
        exited = self._verify_exit(spec)
        removed = self.remove_utility(spec)
        return {
            "container_id": identifier, "exited_identity_sha256": exited,
            "removed_identity_sha256": removed,
        }

    def probe(self, spec: dict[str, Any]) -> dict[str, Any]:
        domain = spec["domain"]
        arguments = [domain]
        reader_gid = None
        if domain == "backup_status":
            reader_gid = spec["backup_status_reader_gid"]
            arguments.append(str(reader_gid))
        identifier = self._create_and_admit(spec, "probe", arguments)
        output = self.runner.probe_volume(domain, reader_gid)
        probe = parse_volume_helper_probe(output)
        exited = self._verify_exit(spec)
        return {
            **probe, "container_id": identifier, "exited_identity_sha256": exited,
        }


class ClosedComposeRunner:
    """Single-opcode direct Compose plugin runner with a sealed derived overlay."""

    FIXED_ENVIRONMENT = {
        "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "LC_ALL": "C",
        "LANG": "C",
        "TZ": "UTC",
        "HOME": "/nonexistent",
        "DOCKER_HOST": "unix:///var/run/docker.sock",
        "COMPOSE_PARALLEL_LIMIT": "1",
        "COMPOSE_DISABLE_ENV_FILE": "1",
        "COMPOSE_REMOVE_ORPHANS": "0",
        "COMPOSE_ANSI": "never",
    }
    FORBIDDEN_ENVIRONMENT_PREFIXES = ("DOCKER_", "COMPOSE_")
    MAX_SOURCE_BYTES = 4 * 1024 * 1024
    MAX_STREAM_BYTES = 1024 * 1024

    def __init__(
            self, compose_plugin_fd: int, plan: dict[str, Any], *, action_deadline: str,
            wall_clock: Any = time.time, monotonic_clock: Any = time.monotonic,
    ):
        if not isinstance(compose_plugin_fd, int) or compose_plugin_fd < 3:
            reject("ROLLBACK_FIXED_EXECUTOR_COMPOSE_PLUGIN_FD_INVALID")
        toolchain = plan.get("toolchain") if isinstance(plan, dict) else None
        spec = toolchain.get("compose_plugin") if isinstance(toolchain, dict) else None
        if not isinstance(spec, dict) or set(spec) != {"path", "sha256", "uid", "gid", "mode"} \
                or spec.get("path") != COMPOSE_PLUGIN_FILE or spec.get("uid") != 0 \
                or spec.get("gid") != 0 or spec.get("mode") != "0755" \
                or not SHA256.fullmatch(spec.get("sha256") or ""):
            reject("ROLLBACK_FIXED_EXECUTOR_COMPOSE_PLUGIN_FD_INVALID")
        try:
            metadata = os.fstat(compose_plugin_fd)
        except OSError:
            reject("ROLLBACK_FIXED_EXECUTOR_COMPOSE_PLUGIN_FD_INVALID")
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_gid != 0 \
                or stat.S_IMODE(metadata.st_mode) != 0o755 or metadata.st_nlink != 1 \
                or sha256_fd(compose_plugin_fd) != spec["sha256"]:
            reject("ROLLBACK_FIXED_EXECUTOR_COMPOSE_PLUGIN_FD_INVALID")
        self.compose_plugin_fd = compose_plugin_fd
        self.compose_plugin_identity = (
            metadata.st_dev, metadata.st_ino, metadata.st_uid, metadata.st_gid,
            stat.S_IMODE(metadata.st_mode), metadata.st_nlink, spec["sha256"],
        )
        self.plan = plan
        self.deadline_budget = ActionDeadlineBudget(
            action_deadline, wall_clock=wall_clock, monotonic_clock=monotonic_clock,
        )

    @staticmethod
    def _group_exists(group_id: int) -> bool:
        try:
            os.killpg(group_id, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            return True

    @staticmethod
    def _kill_group(process: subprocess.Popen[bytes]) -> None:
        ClosedDockerRunner._kill_group(process)

    @classmethod
    def _read_bound_source(cls, descriptor: int, expected_sha256: str, code: str) -> bytes:
        if not isinstance(descriptor, int) or descriptor < 3 \
                or not SHA256.fullmatch(expected_sha256 or ""):
            reject(code)
        try:
            metadata = os.fstat(descriptor)
        except OSError:
            reject(code)
        if not stat.S_ISREG(metadata.st_mode):
            reject(code)
        raw = bytearray()
        offset = 0
        while len(raw) <= cls.MAX_SOURCE_BYTES:
            try:
                chunk = os.pread(
                    descriptor, min(65536, cls.MAX_SOURCE_BYTES + 1 - len(raw)), offset,
                )
            except OSError:
                reject(code)
            if not chunk:
                break
            raw.extend(chunk)
            offset += len(chunk)
        if not raw or len(raw) > cls.MAX_SOURCE_BYTES \
                or hashlib.sha256(raw).hexdigest() != expected_sha256:
            reject(code)
        return bytes(raw)

    @classmethod
    def _validate_deployment_environment(cls, raw: bytes) -> None:
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            reject("ROLLBACK_FIXED_EXECUTOR_COMPOSE_ENVIRONMENT_INVALID")
        if "\x00" in text or "\r" in text:
            reject("ROLLBACK_FIXED_EXECUTOR_COMPOSE_ENVIRONMENT_INVALID")
        keys: set[str] = set()
        for line in text.split("\n"):
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            match = re.fullmatch(r"(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)", line)
            if match is None:
                reject("ROLLBACK_FIXED_EXECUTOR_COMPOSE_ENVIRONMENT_INVALID")
            key = match.group(1)
            if key in keys or key.startswith(cls.FORBIDDEN_ENVIRONMENT_PREFIXES):
                reject("ROLLBACK_FIXED_EXECUTOR_COMPOSE_ENVIRONMENT_INVALID")
            keys.add(key)

    @staticmethod
    def _sealed_memfd(raw: bytes) -> int:
        required = (
            "MFD_CLOEXEC", "MFD_ALLOW_SEALING", "F_ADD_SEALS", "F_GET_SEALS",
            "F_SEAL_SEAL", "F_SEAL_SHRINK", "F_SEAL_GROW", "F_SEAL_WRITE",
        )
        if not hasattr(os, "memfd_create") or any(
            not hasattr(os if name.startswith("MFD_") else fcntl, name) for name in required
        ):
            reject("ROLLBACK_FIXED_EXECUTOR_COMPOSE_OVERLAY_SEAL_FAILED")
        descriptor = -1
        try:
            descriptor = os.memfd_create(
                "chenyida-erp-rollback-overlay",
                os.MFD_CLOEXEC | os.MFD_ALLOW_SEALING,
            )
            offset = 0
            while offset < len(raw):
                written = os.write(descriptor, raw[offset:])
                if written <= 0:
                    raise OSError("short write")
                offset += written
            os.fchmod(descriptor, 0o400)
            os.lseek(descriptor, 0, os.SEEK_SET)
            seals = (
                fcntl.F_SEAL_SEAL | fcntl.F_SEAL_SHRINK
                | fcntl.F_SEAL_GROW | fcntl.F_SEAL_WRITE
            )
            fcntl.fcntl(descriptor, fcntl.F_ADD_SEALS, seals)
            if fcntl.fcntl(descriptor, fcntl.F_GET_SEALS) != seals \
                    or sha256_fd(descriptor) != hashlib.sha256(raw).hexdigest():
                raise OSError("seal mismatch")
            return descriptor
        except OSError:
            if descriptor >= 0:
                os.close(descriptor)
            reject("ROLLBACK_FIXED_EXECUTOR_COMPOSE_OVERLAY_SEAL_FAILED")
        raise AssertionError("unreachable")

    def _recheck_plugin(self) -> None:
        try:
            metadata = os.fstat(self.compose_plugin_fd)
            observed = (
                metadata.st_dev, metadata.st_ino, metadata.st_uid, metadata.st_gid,
                stat.S_IMODE(metadata.st_mode), metadata.st_nlink,
                sha256_fd(self.compose_plugin_fd),
            )
        except OSError:
            reject("ROLLBACK_FIXED_EXECUTOR_COMPOSE_PLUGIN_FD_CHANGED")
        if observed != self.compose_plugin_identity:
            reject("ROLLBACK_FIXED_EXECUTOR_COMPOSE_PLUGIN_FD_CHANGED")

    def activate_predecessor_writers(
            self, deployment_environment_fd: int, compose_fd: int,
            compose_release_fd: int, *, timeout_seconds: float = 300,
    ) -> dict[str, Any]:
        bindings = self.plan.get("source_bindings")
        if not isinstance(bindings, dict):
            reject("ROLLBACK_FIXED_EXECUTOR_COMPOSE_SOURCE_INVALID")
        deployment_environment = self._read_bound_source(
            deployment_environment_fd, bindings.get("deployment_environment_sha256"),
            "ROLLBACK_FIXED_EXECUTOR_COMPOSE_ENVIRONMENT_INVALID",
        )
        self._validate_deployment_environment(deployment_environment)
        self._read_bound_source(
            compose_fd, bindings.get("compose_file_sha256"),
            "ROLLBACK_FIXED_EXECUTOR_COMPOSE_SOURCE_INVALID",
        )
        self._read_bound_source(
            compose_release_fd, bindings.get("compose_release_file_sha256"),
            "ROLLBACK_FIXED_EXECUTOR_COMPOSE_SOURCE_INVALID",
        )
        source_fds = (deployment_environment_fd, compose_fd, compose_release_fd)
        if len(set(source_fds)) != len(source_fds) or self.compose_plugin_fd in source_fds:
            reject("ROLLBACK_FIXED_EXECUTOR_COMPOSE_SOURCE_INVALID")
        if not 0.1 <= timeout_seconds <= 1800:
            reject("ROLLBACK_FIXED_EXECUTOR_COMPOSE_LIMIT_INVALID")
        timeout_seconds = self.deadline_budget.clip(timeout_seconds)
        overlay = create_rollback_compose_overlay(self.plan)
        overlay_raw = overlay["content"].encode()
        overlay_fd = self._sealed_memfd(overlay_raw)
        executable = f"/proc/self/fd/{self.compose_plugin_fd}"
        arguments = [
            executable, "--ansi", "never", "--progress", "quiet",
            "--project-name", self.plan["deployment"]["compose_project"],
            "--project-directory", self.plan["deployment"]["compose_project_root"],
            "--env-file", f"/proc/self/fd/{deployment_environment_fd}",
            "-f", f"/proc/self/fd/{compose_fd}",
            "-f", f"/proc/self/fd/{compose_release_fd}",
            "-f", f"/proc/self/fd/{overlay_fd}",
            "up", "--detach", "--no-deps", "--pull", "never", "--no-build",
            "--force-recreate", "web", "worker",
        ]
        passed = tuple(sorted((*source_fds, overlay_fd, self.compose_plugin_fd)))
        process: subprocess.Popen[bytes] | None = None
        selector = selectors.DefaultSelector()
        streams = {"stdout": bytearray(), "stderr": bytearray()}
        deadline = time.monotonic() + timeout_seconds
        try:
            try:
                process = subprocess.Popen(
                    arguments, executable=executable, cwd="/", env=dict(self.FIXED_ENVIRONMENT),
                    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    pass_fds=passed, start_new_session=True,
                )
            except OSError:
                reject("ROLLBACK_FIXED_EXECUTOR_COMPOSE_EXEC_FAILED")
            assert process.stdout is not None and process.stderr is not None
            for stream, name in ((process.stdout, "stdout"), (process.stderr, "stderr")):
                os.set_blocking(stream.fileno(), False)
                selector.register(stream, selectors.EVENT_READ, name)
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    self._kill_group(process)
                    raise HandlerOutcomeUnknown(
                        "TOOL_TIMEOUT", "AFTER_SIDE_EFFECT", side_effects_started=True,
                    )
                for selected, _mask in selector.select(min(remaining, 0.25)):
                    try:
                        chunk = os.read(selected.fileobj.fileno(), 65536)
                    except BlockingIOError:
                        continue
                    if not chunk:
                        selector.unregister(selected.fileobj)
                        continue
                    streams[selected.data].extend(chunk)
                    if len(streams[selected.data]) > self.MAX_STREAM_BYTES:
                        self._kill_group(process)
                        raise HandlerOutcomeUnknown(
                            "TOOL_OUTPUT_LIMIT", "AFTER_SIDE_EFFECT", side_effects_started=True,
                        )
            remaining = deadline - time.monotonic()
            try:
                return_code = process.wait(timeout=max(0.001, remaining))
            except subprocess.TimeoutExpired:
                self._kill_group(process)
                raise HandlerOutcomeUnknown(
                    "TOOL_TIMEOUT", "AFTER_SIDE_EFFECT", side_effects_started=True,
                )
            if return_code < 0:
                raise HandlerOutcomeUnknown(
                    "TOOL_SIGNAL", "AFTER_SIDE_EFFECT", side_effects_started=True,
                )
            if return_code != 0:
                raise HandlerOutcomeUnknown(
                    "SIDE_EFFECT_OUTCOME_UNKNOWN", "AFTER_SIDE_EFFECT",
                    side_effects_started=True,
                )
            if self._group_exists(process.pid):
                self._kill_group(process)
                raise HandlerOutcomeUnknown(
                    "TOOL_DAEMON_LEFT_RUNNING", "AFTER_SIDE_EFFECT",
                    side_effects_started=True,
                )
            self._recheck_plugin()
            body = {
                "schema_version": 1,
                "contract": "chenyida-erp-uat-promotion-rollback-compose-invocation-receipt/v1",
                "status": "COMMITTED",
                "runtime_plan_sha256": self.plan["runtime_plan_sha256"],
                "compose_plugin_sha256":
                    self.plan["toolchain"]["compose_plugin"]["sha256"],
                "deployment_environment_sha256": bindings["deployment_environment_sha256"],
                "compose_file_sha256": bindings["compose_file_sha256"],
                "compose_release_file_sha256": bindings["compose_release_file_sha256"],
                "compose_rollback_overlay_sha256":
                    overlay["compose_rollback_overlay_sha256"],
                "argv_template_sha256": digest_value(
                    derive_rollback_runtime_projection(self.plan)["activation_argv_template"],
                ),
                "fixed_environment_sha256": digest_value(self.FIXED_ENVIRONMENT),
                "stdout_bytes": len(streams["stdout"]),
                "stdout_sha256": hashlib.sha256(streams["stdout"]).hexdigest(),
                "stderr_bytes": len(streams["stderr"]),
                "stderr_sha256": hashlib.sha256(streams["stderr"]).hexdigest(),
                "exit_code": return_code,
            }
            return {**body, "receipt_sha256": digest_value(body)}
        finally:
            selector.close()
            if process is not None:
                for stream in (process.stdout, process.stderr):
                    if stream is not None:
                        try:
                            stream.close()
                        except OSError:
                            pass
                if process.poll() is None:
                    self._kill_group(process)
            os.close(overlay_fd)


def validate_descriptor(value: Any, code: str) -> int:
    item = exact(value, DESCRIPTOR_FIELDS, code)
    descriptor = item.get("fd")
    path_match = FD_PATH.fullmatch(item.get("path") or "")
    if not isinstance(descriptor, int) or descriptor < 3 or path_match is None \
            or int(path_match.group(1)) != descriptor \
            or not isinstance(item.get("logical_path"), str) \
            or not item["logical_path"].startswith("/") \
            or not SHA256.fullmatch(item.get("sha256") or "") \
            or item.get("uid") != 0 or item.get("gid") != 0 \
            or item.get("mode") not in {"0400", "0440", "0444", "0555", "0755"} \
            or not isinstance(item.get("device"), str) or not item["device"].isdigit() \
            or not isinstance(item.get("inode"), str) or not item["inode"].isdigit() \
            or item.get("nlink") != 1:
        reject(code)
    try:
        metadata = os.fstat(descriptor)
    except OSError:
        reject(code)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != item["uid"] \
            or metadata.st_gid != item["gid"] or mode_text(metadata) != item["mode"] \
            or str(metadata.st_dev) != item["device"] or str(metadata.st_ino) != item["inode"] \
            or metadata.st_nlink != item["nlink"] or sha256_fd(descriptor) != item["sha256"]:
        reject(code)
    return descriptor


def derive_runtime_source_roles(action: str, operation: str, label: str | None) -> list[str]:
    if action == "PREFLIGHT":
        selected = set(PACKAGE_SOURCE_ROLES)
    elif action in {"RECHECK", "CONTAIN"} or action == "PROBE" and label is None:
        selected = {
            "candidate_deployment_result", "candidate_postdeploy_identity",
            "runtime_adapter_activation",
        }
    else:
        mapping = STAGE_SOURCE_ROLES if operation == "ROLLBACK_EXECUTION" \
            else CHECK_SOURCE_ROLES
        selected = {*mapping.get(label, ()), "runtime_adapter_activation"}
    result = [role for role in PACKAGE_SOURCE_ROLES if role in selected]
    if len(result) != len(selected):
        reject("ROLLBACK_FIXED_EXECUTOR_SOURCE_ROLES_INVALID")
    return result


def validate_request(value: Any) -> dict[str, Any]:
    request = exact(value, REQUEST_FIELDS, "ROLLBACK_FIXED_EXECUTOR_REQUEST_INVALID")
    if request.get("schema_version") != 1 or request.get("contract") != REQUEST_CONTRACT \
            or request.get("operation") not in {"ROLLBACK_EXECUTION", "ROLLBACK_POSTVERIFY"} \
            or request.get("execution_mode") not in {"ORIGINAL", "RECOVERY"} \
            or not IDENTIFIER.fullmatch(request.get("operation_id") or "") \
            or not SHA256.fullmatch(request.get("request_sha256") or "") \
            or digest_value(without(request, "request_sha256")) != request["request_sha256"]:
        reject("ROLLBACK_FIXED_EXECUTOR_REQUEST_INVALID")
    for field in (
        "execution_package_sha256", "source_set_sha256", "transaction_intent_sha256",
        "runtime_plan_sha256", "context_sha256", "payload_sha256",
    ):
        if not SHA256.fullmatch(request.get(field) or "") or request[field] == ZERO_SHA256:
            reject("ROLLBACK_FIXED_EXECUTOR_REQUEST_INVALID")
    for field in ("record_intent_sha256", "previous_result_sha256"):
        if not SHA256.fullmatch(request.get(field) or ""):
            reject("ROLLBACK_FIXED_EXECUTOR_REQUEST_INVALID")
    payload = request.get("payload")
    if not isinstance(payload, dict) or not isinstance(payload.get("context"), dict) \
            or digest_value(payload) != request["payload_sha256"] \
            or digest_value(payload["context"]) != request["context_sha256"]:
        reject("ROLLBACK_FIXED_EXECUTOR_REQUEST_INVALID")
    source_roles = request.get("source_roles")
    if not isinstance(source_roles, list) or len(source_roles) != len(set(source_roles)) \
            or not source_roles or "runtime_adapter_activation" not in source_roles \
            or any(role not in SOURCE_ROLES for role in source_roles):
        reject("ROLLBACK_FIXED_EXECUTOR_SOURCE_ROLES_INVALID")
    try:
        instants = {
            field: datetime.strptime(request[field], "%Y-%m-%dT%H:%M:%S.%fZ").replace(
                tzinfo=timezone.utc,
            )
            for field in (
                "requested_at", "execution_deadline", "authorization_expires_at", "action_deadline",
            )
            if isinstance(request.get(field), str) and ISO_UTC.fullmatch(request[field])
        }
    except ValueError:
        reject("ROLLBACK_FIXED_EXECUTOR_REQUEST_INVALID")
    if len(instants) != 4 or instants["action_deadline"] <= instants["requested_at"] \
            or instants["action_deadline"] > instants["authorization_expires_at"] \
            or request["execution_mode"] == "ORIGINAL" \
                and instants["action_deadline"] > instants["execution_deadline"] \
            or instants["action_deadline"] - instants["requested_at"] > timedelta(minutes=30):
        reject("ROLLBACK_FIXED_EXECUTOR_REQUEST_INVALID")
    expected_labels = STAGES if request["operation"] == "ROLLBACK_EXECUTION" else CHECKS
    action = request.get("action")
    label = request.get("label")
    if action not in {"PREFLIGHT", "RECHECK", "PREPARE", "EXECUTE", "PROBE", "CONTAIN"} \
            or request["record_intent_sha256"] == ZERO_SHA256 \
                and action not in {"PREFLIGHT", "RECHECK"} \
            or action in TIMEOUTS and instants["action_deadline"] - instants["requested_at"] \
                > timedelta(seconds=action_timeout_seconds(action, label)):
        reject("ROLLBACK_FIXED_EXECUTOR_DISPATCH_INVALID")
    if request["execution_mode"] == "RECOVERY" and (
        label is not None or action == "EXECUTE"
        or action not in {"PREFLIGHT", "RECHECK", "PROBE", "CONTAIN"}
    ):
        reject("ROLLBACK_FIXED_EXECUTOR_DISPATCH_INVALID")
    if action in {"PREFLIGHT", "RECHECK", "CONTAIN"} or action == "PROBE" and label is None:
        if label is not None:
            reject("ROLLBACK_FIXED_EXECUTOR_DISPATCH_INVALID")
    elif not isinstance(label, str) or not LABEL.fullmatch(label) or label not in expected_labels:
        reject("ROLLBACK_FIXED_EXECUTOR_DISPATCH_INVALID")
    elif request["operation"] == "ROLLBACK_EXECUTION" and action not in {"PREPARE", "EXECUTE", "PROBE"} \
            or request["operation"] == "ROLLBACK_POSTVERIFY" and action not in {"PREPARE", "PROBE"}:
        reject("ROLLBACK_FIXED_EXECUTOR_DISPATCH_INVALID")
    if source_roles != derive_runtime_source_roles(action, request["operation"], label):
        reject("ROLLBACK_FIXED_EXECUTOR_SOURCE_ROLES_INVALID")
    return request


def idempotency_key(request: dict[str, Any]) -> str:
    return digest_value({
        "contract": "chenyida-erp-uat-promotion-rollback-idempotency-key/v2",
        "operation_id": request["operation_id"],
        "execution_mode": request["execution_mode"],
        "action": request["action"],
        "label": request["label"],
        "record_intent_sha256": request["record_intent_sha256"],
        "runtime_plan_sha256": request["runtime_plan_sha256"],
        "previous_result_sha256": request["previous_result_sha256"],
    })


def expected_handler(request: dict[str, Any]) -> str:
    if request["label"] is None:
        return "chenyida-erp.rollback.runtime-observation.v1"
    return HANDLERS[request["label"]]


def expected_argv_template(request: dict[str, Any]) -> list[str]:
    if request["label"] is None:
        return ["EXECUTOR_INTERNAL", "RUNTIME_OBSERVATION"]
    if request["label"] in INTERNAL_HANDLERS:
        return ["EXECUTOR_INTERNAL", request["label"]]
    if request["label"] == "WEB_WORKER_PREDECESSOR_ACTIVATION":
        return [
            "/proc/self/fd/{compose_plugin_fd}", "FIXED_HANDLER",
            "WEB_WORKER_PREDECESSOR_ACTIVATION",
        ]
    return ["/proc/self/fd/{docker_fd}", "FIXED_HANDLER", request["label"]]


def validate_manifest(value: Any, request: dict[str, Any]) -> dict[str, Any]:
    manifest = exact(value, MANIFEST_FIELDS, "ROLLBACK_FIXED_EXECUTOR_FD_MANIFEST_INVALID")
    if manifest.get("schema_version") != 3 or manifest.get("contract") != FD_MANIFEST_CONTRACT \
            or digest_value(without(manifest, "manifest_sha256")) != manifest.get("manifest_sha256"):
        reject("ROLLBACK_FIXED_EXECUTOR_FD_MANIFEST_INVALID")
    for field in (
        "request_sha256", "action", "operation", "operation_id", "execution_mode", "label",
        "runtime_plan_sha256", "execution_package_sha256", "transaction_intent_sha256",
        "record_intent_sha256", "source_set_sha256", "previous_result_sha256", "action_deadline",
    ):
        if manifest.get(field) != request.get(field):
            reject("ROLLBACK_FIXED_EXECUTOR_FD_MANIFEST_BINDING_INVALID")
    handler_id = expected_handler(request)
    if manifest.get("handler_id") != handler_id \
            or manifest.get("idempotency_key") != idempotency_key(request) \
            or manifest.get("argv_template_sha256") != digest_value(expected_argv_template(request)):
        reject("ROLLBACK_FIXED_EXECUTOR_DISPATCH_INVALID")
    activation = exact(manifest.get("activation"), {
        "contract", "activation_id", "generation", "activation_sha256", "history_sha256",
        "receipt_sha256",
        "current_sha256", "executor_catalog_sha256", "capability_status",
        "supervisor_bundle_sha256", "installed_executor_sha256", "runtime_plan_sha256",
        "docker_sha256", "compose_plugin_sha256",
    }, "ROLLBACK_FIXED_EXECUTOR_ACTIVATION_INVALID")
    if activation.get("contract") != ACTIVATION_CONTRACT \
            or not IDENTIFIER.fullmatch(activation.get("activation_id") or "") \
            or not isinstance(activation.get("generation"), int) or activation["generation"] < 1 \
            or any(not SHA256.fullmatch(activation.get(field) or "") for field in (
                "activation_sha256", "history_sha256", "receipt_sha256", "current_sha256",
                "executor_catalog_sha256",
                "supervisor_bundle_sha256", "installed_executor_sha256", "runtime_plan_sha256",
                "docker_sha256",
                "compose_plugin_sha256",
            )) \
            or activation.get("executor_catalog_sha256") != CATALOG_SHA256 \
            or activation.get("capability_status") != CAPABILITY_STATUS \
            or activation.get("runtime_plan_sha256") != request["runtime_plan_sha256"] \
            or activation.get("supervisor_bundle_sha256") \
                != request["payload"]["context"].get("supervisor_bundle_sha256"):
        reject("ROLLBACK_FIXED_EXECUTOR_ACTIVATION_INVALID")
    executor_item = manifest.get("executor")
    docker_item = manifest.get("docker")
    compose_plugin_item = manifest.get("compose_plugin")
    descriptors = [
        validate_descriptor(executor_item, "ROLLBACK_FIXED_EXECUTOR_EXECUTOR_FD_INVALID"),
        validate_descriptor(docker_item, "ROLLBACK_FIXED_EXECUTOR_DOCKER_FD_INVALID"),
        validate_descriptor(
            compose_plugin_item, "ROLLBACK_FIXED_EXECUTOR_COMPOSE_PLUGIN_FD_INVALID",
        ),
    ]
    if executor_item["logical_path"] != EXECUTOR_FILE or executor_item["mode"] != "0555" \
            or executor_item["sha256"] != activation["installed_executor_sha256"]:
        reject("ROLLBACK_FIXED_EXECUTOR_EXECUTOR_FD_INVALID")
    if docker_item["logical_path"] != DOCKER_FILE or docker_item["mode"] != "0755" \
            or docker_item["sha256"] != activation["docker_sha256"]:
        reject("ROLLBACK_FIXED_EXECUTOR_DOCKER_FD_INVALID")
    if compose_plugin_item["logical_path"] != COMPOSE_PLUGIN_FILE \
            or compose_plugin_item["mode"] != "0755" \
            or compose_plugin_item["sha256"] != activation["compose_plugin_sha256"]:
        reject("ROLLBACK_FIXED_EXECUTOR_COMPOSE_PLUGIN_FD_INVALID")
    chain = exact(manifest.get("activation_chain"), {"alias", "history", "receipt", "current"},
                  "ROLLBACK_FIXED_EXECUTOR_ACTIVATION_INVALID")
    descriptors.extend(validate_descriptor(chain[name], "ROLLBACK_FIXED_EXECUTOR_ACTIVATION_INVALID")
                       for name in ("alias", "history", "receipt", "current"))
    ordinal = str(activation["generation"]).zfill(16)
    expected_chain_paths = {
        "alias": ACTIVATION_FILE,
        "current": CURRENT_FILE,
        "history": "/var/lib/chenyida-erp-release-supervisor/uat-rollback-runtime-adapter/history/"
            f"{ordinal}.{activation['history_sha256']}.json",
        "receipt": "/var/lib/chenyida-erp-release-supervisor/uat-rollback-runtime-adapter/receipts/"
            f"{ordinal}.{activation['receipt_sha256']}.json",
    }
    if chain["alias"]["logical_path"] != expected_chain_paths["alias"] \
            or chain["current"]["logical_path"] != expected_chain_paths["current"] \
            or chain["receipt"]["logical_path"] != expected_chain_paths["receipt"] \
            or chain["history"]["logical_path"] != expected_chain_paths["history"]:
        reject("ROLLBACK_FIXED_EXECUTOR_ACTIVATION_INVALID")
    sources = manifest.get("sources")
    if not isinstance(sources, dict) or set(sources) != set(request.get("source_roles") or []):
        reject("ROLLBACK_FIXED_EXECUTOR_SOURCE_FD_INVALID")
    package_sources = request["payload"].get("execution_package", {}).get("sources")
    if not isinstance(package_sources, dict):
        reject("ROLLBACK_FIXED_EXECUTOR_SOURCE_FD_INVALID")
    for role in request["source_roles"]:
        descriptors.append(validate_descriptor(
            sources[role], "ROLLBACK_FIXED_EXECUTOR_SOURCE_FD_INVALID",
        ))
        spec = package_sources.get(role)
        if not isinstance(spec, dict) or any(
            sources[role].get(descriptor_field) != spec.get(source_field)
            for descriptor_field, source_field in (
                ("logical_path", "path"), ("sha256", "sha256"), ("uid", "uid"),
                ("gid", "gid"), ("mode", "mode"), ("device", "device"),
                ("inode", "inode"), ("nlink", "nlink"),
            )
        ):
            reject("ROLLBACK_FIXED_EXECUTOR_SOURCE_FD_INVALID")
    if chain["alias"] != sources.get("runtime_adapter_activation"):
        reject("ROLLBACK_FIXED_EXECUTOR_ACTIVATION_INVALID")
    inherited = manifest.get("inherited_fds")
    if not isinstance(inherited, list) or inherited != sorted(set(inherited)) \
            or any(not isinstance(item, int) or item < 3 for item in inherited):
        reject("ROLLBACK_FIXED_EXECUTOR_INHERITED_FDS_INVALID")
    manifest_fd = int(os.environ.get("CHENYIDA_ERP_ROLLBACK_TRUSTED_FD_MANIFEST_FD", "-1"))
    lock_fd = int(os.environ.get("ERP_RELEASE_GATE_LOCK_FD", "-1"))
    expected_fds = sorted(set([*descriptors, manifest_fd, lock_fd]))
    if inherited != expected_fds:
        reject("ROLLBACK_FIXED_EXECUTOR_INHERITED_FDS_INVALID")
    opened: list[int] = []
    for name in os.listdir("/proc/self/fd"):
        if not name.isdigit() or int(name) < 3:
            continue
        try:
            os.fstat(int(name))
            opened.append(int(name))
        except OSError:
            pass
    if sorted(set(opened)) != inherited:
        reject("ROLLBACK_FIXED_EXECUTOR_INHERITED_FDS_INVALID")
    return manifest


def validate_and_select(request: dict[str, Any], manifest: dict[str, Any]) -> dict[str, Any]:
    """Pure validated dispatch result used by the fake-root table tests."""
    request = validate_request(request)
    manifest = validate_manifest(manifest, request)
    label = request["label"]
    operation_available = label is None and request["action"] in {
        "PREFLIGHT", "RECHECK", "PROBE", "CONTAIN",
    }
    return {
        "schema_version": 1,
        "contract": EXECUTOR_CONTRACT,
        "handler_id": expected_handler(request),
        "idempotency_key": idempotency_key(request),
        "capability_status": CAPABILITY_STATUS,
        "label_status": "AVAILABLE_DORMANT_IMPLEMENTED_ONLY"
            if operation_available or label in DORMANT_CAPABILITY_HANDLERS
            else "UNAVAILABLE",
        "manifest_sha256": manifest["manifest_sha256"],
    }


def dispatch_dormant_metadata_handler(
        request: dict[str, Any], manifest: dict[str, Any], *, filesystem_root: str = "/",
) -> dict[str, Any]:
    """Execute only individually implemented handlers while the UAT catalog remains blocked."""
    selection = validate_and_select(request, manifest)
    operation_available = request["label"] is None and request["action"] in {
        "PREFLIGHT", "RECHECK", "PROBE", "CONTAIN",
    }
    if selection["label_status"] != "AVAILABLE_DORMANT_IMPLEMENTED_ONLY" \
            or not operation_available \
                and request["label"] not in DORMANT_CAPABILITY_HANDLERS:
        reject("ROLLBACK_FIXED_EXECUTOR_UAT_CAPABILITY_UNAVAILABLE")
    volume_driver = None
    postgres_driver = None
    writer_driver = None
    activation_driver = None
    protected_driver = None
    service_driver = None
    health_driver = None
    operation_driver = None
    release_driver = ClosedRollbackReleasePublisher(filesystem_root=filesystem_root) \
        if request["label"] in (
            ACTIVATION_EXECUTION_HANDLERS | {"STRICT_RELEASE_IDENTITY", "HEALTH"}
        ) else None
    if operation_available or request["label"] in (
            WRITER_EXECUTION_HANDLERS | POSTGRES_EXECUTION_HANDLERS
            | VOLUME_EXECUTION_HANDLERS | ACTIVATION_EXECUTION_HANDLERS
            | PROTECTED_EXECUTION_HANDLERS
            | VOLUME_POSTVERIFY_HANDLERS | POSTGRES_POSTVERIFY_HANDLERS
            | SERVICE_POSTVERIFY_HANDLERS
            | HEALTH_POSTVERIFY_HANDLERS
    ):
        inputs = CapabilityInputs(request, manifest)
        runner = ClosedDockerRunner(
            manifest["docker"]["fd"], inputs.plan,
            action_deadline=request["action_deadline"],
        )
        if operation_available:
            operation_driver = ClosedRuntimeOperationDriver(runner)
        elif request["label"] in VOLUME_EXECUTION_HANDLERS | VOLUME_POSTVERIFY_HANDLERS:
            volume_driver = ClosedVolumeCapabilityDriver(runner)
        elif request["label"] in SERVICE_POSTVERIFY_HANDLERS:
            service_driver = ClosedServiceIdentityDriver(runner)
        elif request["label"] in HEALTH_POSTVERIFY_HANDLERS:
            health_driver = ClosedHealthCapabilityDriver(runner)
        elif request["label"] in POSTGRES_POSTVERIFY_HANDLERS:
            postgres_driver = ClosedPostgresCapabilityDriver(runner)
        elif request["label"] in WRITER_EXECUTION_HANDLERS:
            writer_driver = ClosedWriterContainmentDriver(runner)
        elif request["label"] in ACTIVATION_EXECUTION_HANDLERS:
            postgres_driver = ClosedPostgresCapabilityDriver(runner)
            activation_driver = ClosedActivationCapabilityDriver(
                runner, postgres_driver,
                ClosedComposeRunner(
                    manifest["compose_plugin"]["fd"], inputs.plan,
                    action_deadline=request["action_deadline"],
                ),
            )
        elif request["label"] in PROTECTED_EXECUTION_HANDLERS:
            protected_driver = ClosedProtectedResourceDriver(runner)
        else:
            postgres_driver = ClosedPostgresCapabilityDriver(runner)
    backend = StructuredCapabilityBackend(
        UatRollbackCapabilityRuntime(
            volume_driver=volume_driver, postgres_driver=postgres_driver,
            writer_driver=writer_driver, activation_driver=activation_driver,
            protected_driver=protected_driver, service_driver=service_driver,
            release_driver=release_driver, health_driver=health_driver,
            operation_driver=operation_driver, filesystem_root=filesystem_root,
        ),
    )
    return FixedHandlerEngine(
        backend, filesystem_root=filesystem_root,
    ).dispatch(request, manifest)


def read_manifest() -> dict[str, Any]:
    descriptor_text = os.environ.get("CHENYIDA_ERP_ROLLBACK_TRUSTED_FD_MANIFEST_FD", "")
    if not re.fullmatch(r"(?:[3-9]|[1-9][0-9]{1,5})", descriptor_text):
        reject("ROLLBACK_FIXED_EXECUTOR_FD_MANIFEST_INVALID")
    descriptor = int(descriptor_text)
    raw = bytearray()
    while len(raw) <= MAX_JSON_BYTES:
        chunk = os.read(descriptor, min(64 * 1024, MAX_JSON_BYTES + 1 - len(raw)))
        if not chunk:
            break
        raw.extend(chunk)
    return strict_json(bytes(raw), "ROLLBACK_FIXED_EXECUTOR_FD_MANIFEST_INVALID")


def validate_argv(request: dict[str, Any]) -> None:
    expected = [request["action"].lower(), request["operation_id"]]
    if request["label"] is not None:
        expected.append(request["label"])
    if sys.argv[1:] != expected:
        reject("ROLLBACK_FIXED_EXECUTOR_ARGV_INVALID")


def main() -> None:
    try:
        request = validate_request(strict_json(sys.stdin.buffer.read(MAX_JSON_BYTES + 1),
                                               "ROLLBACK_FIXED_EXECUTOR_REQUEST_INVALID"))
        validate_argv(request)
        manifest = read_manifest()
        response = dispatch_dormant_metadata_handler(request, manifest)
        sys.stdout.buffer.write(canonical(response))
    except FixedExecutorError as error:
        sys.stderr.write(f"{error.code}\n")
        raise SystemExit(1) from None
    except Exception:
        sys.stderr.write("ROLLBACK_FIXED_EXECUTOR_INTERNAL_ERROR\n")
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
