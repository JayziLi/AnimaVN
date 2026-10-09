"""更新接口里给非空字段显式传 null:当成不改,不能 500"""


def test_null_for_required_fields_is_ignored(client, make_connection):
    conn = make_connection()
    r = client.put(f"/api/connections/{conn['id']}", json={"name": None, "stream": None, "model": "m2"})
    assert r.status_code == 200
    assert r.json()["name"] == conn["name"] and r.json()["model"] == "m2"

    persona = client.post("/api/personas", json={"name": "甲", "description": ""}).json()
    r = client.patch(f"/api/personas/{persona['id']}", json={"name": None, "description": "新"})
    assert r.status_code == 200
    assert r.json()["name"] == "甲" and r.json()["description"] == "新"
