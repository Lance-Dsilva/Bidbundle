import 'package:flutter/foundation.dart';

import '../../core/api.dart';
import 'models.dart';

enum ServiceAreasStatus { idle, loading, ready, failed }

class ServiceAreasModel extends ChangeNotifier {
  ServiceAreasModel(this.repository, {required this.onSessionExpired});
  final ServiceAreasRepository repository;
  final VoidCallback onSessionExpired;
  String? _owner;
  int _generation = 0;
  bool _disposed = false;
  ServiceAreasStatus status = ServiceAreasStatus.idle;
  List<ServiceArea> items = const [];
  String? message;
  void close() {
    final owner = _owner;
    clear();
    _owner = owner;
  }

  void _emit() {
    if (!_disposed) notifyListeners();
  }

  void setOwner(String? id) {
    if (_owner == id) return;
    clear();
    if (id != null && id.isNotEmpty) _owner = id;
  }

  void clear() {
    _owner = null;
    _generation++;
    items = const [];
    message = null;
    status = ServiceAreasStatus.idle;
    _emit();
  }

  bool _current(String owner, int generation) =>
      !_disposed && _owner == owner && generation == _generation;
  Future<void> load() async {
    final owner = _owner;
    if (_disposed || owner == null || status == ServiceAreasStatus.loading) {
      return;
    }
    final generation = ++_generation;
    items = const [];
    message = null;
    status = ServiceAreasStatus.loading;
    _emit();
    try {
      final loaded = await repository.load();
      if (!_current(owner, generation)) return;
      items = loaded;
      status = ServiceAreasStatus.ready;
      _emit();
    } catch (error) {
      if (!_current(owner, generation)) return;
      if (error is ApiFailure && error.kind == FailureKind.unauthenticated) {
        clear();
        onSessionExpired();
        return;
      }
      status = ServiceAreasStatus.failed;
      message = 'We could not load service areas. Please try again.';
      _emit();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    super.dispose();
  }
}
