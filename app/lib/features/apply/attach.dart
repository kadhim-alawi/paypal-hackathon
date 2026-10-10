import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:image_picker/image_picker.dart';

class PickedFile {
  PickedFile(this.bytes, this.name, this.mimeType);
  final Uint8List bytes;
  final String name;
  final String mimeType;
}

String mimeFor(String name, [String? declared]) {
  if (declared != null && declared.contains('/')) return declared;
  final ext = name.split('.').last.toLowerCase();
  return switch (ext) {
    'jpg' || 'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    'webp' => 'image/webp',
    'gif' => 'image/gif',
    'pdf' => 'application/pdf',
    _ => 'application/octet-stream',
  };
}

/// Camera on phones; on the web this opens the camera on mobile browsers and a
/// file chooser on desktop.
Future<PickedFile?> takePhoto() async {
  final x = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 2200, imageQuality: 85);
  if (x == null) return null;
  return PickedFile(await x.readAsBytes(), x.name, mimeFor(x.name, x.mimeType));
}

Future<PickedFile?> pickDocument() async {
  final f = await FilePicker.pickFile(
    type: FileType.custom,
    allowedExtensions: const ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
  );
  if (f == null) return null;
  return PickedFile(await f.readAsBytes(), f.name, mimeFor(f.name));
}

bool get cameraLikelyAvailable => !kIsWeb || defaultTargetPlatform == TargetPlatform.android || defaultTargetPlatform == TargetPlatform.iOS;
