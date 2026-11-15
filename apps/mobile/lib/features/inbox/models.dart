import '../../core/api.dart';
import '../../core/json_fields.dart';
import '../home/models.dart';

String _text(Map<String, dynamic> json, String key) {
  final value = field<String>(json, key);
  if (value.trim().isEmpty) throw const ApiFailure(FailureKind.invalidResponse);
  return value;
}

class InboxThread {
  InboxThread.fromJson(Map<String, dynamic> json)
    : id = _text(json, 'id'),
      requestTitle = field<String>(json, 'requestTitle'),
      communityName = field<String>(json, 'communityName'),
      otherPartyName = field<String>(json, 'otherPartyName'),
      otherPartyRole = _text(json, 'otherPartyRole'),
      lastMessagePreview = nullableWireText(json, 'lastMessagePreview'),
      lastMessageAt = wireDate(json, 'lastMessageAt') {
    if (!{'customer', 'provider'}.contains(otherPartyRole)) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
  }
  final String id, requestTitle, communityName, otherPartyName, otherPartyRole;
  final String? lastMessagePreview;
  final DateTime? lastMessageAt;
}

class InboxMessage {
  InboxMessage.fromJson(Map<String, dynamic> json)
    : id = _text(json, 'id'),
      conversationId = _text(json, 'conversationId'),
      senderName = field<String>(json, 'senderName'),
      isMine = field<bool>(json, 'isMine'),
      body = field<String>(json, 'body'),
      createdAt = wireDate(json, 'createdAt', nullable: false)!;
  final String id, conversationId, senderName, body;
  final bool isMine;
  final DateTime createdAt;
}

class Conversation {
  Conversation.fromJson(Map<String, dynamic> json, String expectedId)
    : thread = InboxThread.fromJson(
        field<Map<String, dynamic>>(json, 'thread'),
      ),
      hasMore = field<bool>(json, 'hasMore') {
    if (thread.id != expectedId) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    final rows = field<List<dynamic>>(json, 'messages');
    if (rows.length > 50) throw const ApiFailure(FailureKind.invalidResponse);
    messages = List.unmodifiable(
      rows.map((row) {
        if (row is! Map<String, dynamic>) {
          throw const ApiFailure(FailureKind.invalidResponse);
        }
        final message = InboxMessage.fromJson(row);
        if (message.conversationId != expectedId) {
          throw const ApiFailure(FailureKind.invalidResponse);
        }
        return message;
      }),
    );
    if (messages.map((item) => item.id).toSet().length != messages.length) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
  }
  final InboxThread thread;
  final bool hasMore;
  late final List<InboxMessage> messages;
}

class InboxRepository {
  InboxRepository(this.api);
  final ApiClient api;
  String _base(String role) => switch (role) {
    'homeowner' || 'hoa_staff' => '/api/homeowner/inbox',
    'provider' => '/api/provider/inbox',
    _ => throw const ApiFailure(FailureKind.invalidResponse),
  };
  Future<List<InboxThread>> loadList(String role) async {
    final envelope = await api.get(_base(role));
    final rows = field<List<dynamic>>(envelope, 'threads');
    if (rows.length > 100) throw const ApiFailure(FailureKind.invalidResponse);
    final items = List<InboxThread>.unmodifiable(
      rows.map((row) {
        if (row is! Map<String, dynamic>) {
          throw const ApiFailure(FailureKind.invalidResponse);
        }
        return InboxThread.fromJson(row);
      }),
    );
    if (items.map((item) => item.id).toSet().length != items.length) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    return items;
  }

  Future<Conversation> loadDetail(String role, String id) async {
    if (id.trim().isEmpty || id == '.' || id == '..') {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    return Conversation.fromJson(
      await api.get(
        '${_base(role)}/${Uri.encodeComponent(id)}?limit=50&offset=0',
      ),
      id,
    );
  }
}
