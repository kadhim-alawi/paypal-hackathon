import 'package:flutter/material.dart';
import 'package:flutter_web_plugins/url_strategy.dart';
import 'package:intl/intl.dart';

import 'app.dart';
import 'core/api.dart';
import 'core/app_scope.dart';
import 'core/models.dart';
import 'core/storage.dart';
import 'widgets/ui.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  usePathUrlStrategy();
  // UI copy is English; formatting must not depend on the browser's locale string.
  Intl.defaultLocale = 'en_US';
  final api = ApiClient();
  final storage = await Storage.open();
  AppInfo info;
  try {
    info = AppInfo(await api.get('/api/config') as Map<String, dynamic>);
  } catch (_) {
    info = AppInfo(const {});
  }
  ModeBanner.configure(paypalMode: info.paypalMode, aiMode: info.aiMode);
  final services = AppServices(api: api, storage: storage, info: info, session: StaffSession(api, storage));
  runApp(AppScope(services: services, child: TideoverApp(services: services)));
}
