import 'package:url_launcher/url_launcher.dart';

import 'config.dart';

/// Opens a URL: same tab on the web (PayPal flows redirect back), external
/// browser on mobile.
Future<void> openUrl(String url, {bool newTab = false}) async {
  final uri = Uri.parse(url);
  if (AppConfig.isWebOrigin) {
    await launchUrl(uri, webOnlyWindowName: newTab ? '_blank' : '_self');
  } else {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }
}
