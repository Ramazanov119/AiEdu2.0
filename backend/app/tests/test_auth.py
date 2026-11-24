from fastapi.testclient import TestClient
from app.main import app

client=TestClient(app)

def test_arbitrary_user_header_is_not_accepted():
    response=client.get('/profile',headers={'X-User-ID':'victim'})
    assert response.status_code==401

def test_chat_requires_authentication():
    response=client.post('/chat/messages',json={'content':'создай контрольную'},headers={'X-User-ID':'victim'})
    assert response.status_code==401
