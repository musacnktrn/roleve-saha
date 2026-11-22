# Rölöve Saha

iPad, telefon ve bilgisayarda mimari saha ölçümü. [Uygulamayı aç](https://musacnktrn.github.io/roleve-saha/)

## İlk ziyaret

1. **Müşteriler → Yeni müşteri** ile kişi veya firma kartını oluştur. Kartın içinden **Yeni proje** seçerek aynı müşteriye istediğin kadar proje bağlayabilirsin. Müşterisiz kişisel çalışma da açılabilir.
2. **Kat ve mahaller → Mahal ekle** ile şablon seç veya kalemle köşeleri işaretle. Bir duvarı seçip **Ölçüyü gir** ile sabit ucu ve ölçünün plana etkisini belirle. **Uçtan uca ölç** aracı bir ölçüyü iki köşe, duvar yüzü, açıklık kenarı veya tanık noktasına bağlar.
3. Seçili duvardan **Yüzü aç** ile iç veya dış görünüşe geç. Eskiz kalemi hem planda hem seçili duvar yüzünde çalışır. Kalemler ve renkler menüsünde teknik kalem, kurşun kalem, fosforlu kalem, serbest çizgi, düz çizgi ve dikdörtgen bulunur. Silgi bir eskiz çizgisini kaldırır. **Geri al** son düzenlemeyi geri getirir.
4. Kamera simgesini aç. İç veya dış çekimde planda önce durduğun yeri, sonra baktığın noktayı seç. Zemin, tavan, duvar, cephe veya detay seçilebilir. Kamerayı kullanabilir veya galeriden fotoğraf seçebilirsin. Adres tarifi ve koordinatlar isteğe bağlıdır. Fotoğraf üstünde ok, yazı, serbest çizgi ve iki uçlu ölçü oluştur. Ölçüyü sahada okuduğun birim ve yöntemle gir. İşaretli görüntüyü PNG olarak indirebilirsin.
5. Tavan, cephe, kesit ve 3B sekmeleri aynı proje verisini gösterir. Asma katlı örnekte platform altı, döşeme üstü ve çift yükseklik birlikte incelenebilir. PDF/yazdır, SVG, DXF, CSV, IFC, OBJ ve tam proje paketi **Dışa aktar** menüsündedir.

6. **Kesit → Kesit çizgisi → Planda yeni kesit çiz** ile A ve B uçlarını seç veya X/Y gir. Bir projede birden fazla kesite ad verebilir, uçlarını değiştirebilir ve bakış yönünü ters çevirebilirsin. Kesitteki kapıya veya pencereye dokununca aynı öğenin ölçü kartı açılır. Parapet, eşik ve açıklık yüksekliğini buradan gir. **Kapı ve pencereler** listesi kesilen açıklıkları katlarıyla gösterir.
7. Kapı kartından menteşe tarafını ve içeri/dışarı açılışı seç. **Detay çizimi** içinde kapı kanadı, cam bölmesi, kemer veya özel doğrama çizebilirsin. Çizgiler seçtiğin öğeye bağlı kalır. **3B** ekranında tek parmak, kalem veya fareyle sürükleyerek modeli döndür. İki parmakla yaklaştır ve kaydır. Bilgisayarda tekerlek yakınlaştırır, Shift ile sürükleme kaydırır.

## Kayıt ve yedek

İlk çevrimiçi açılışın ardından uygulama dosyaları ve açılmış projeler cihazdaki tarayıcıda tutulur. Bir saha ziyareti öncesi aynı tarayıcıda projeyi bir kez aç. iPad’de Safari'nin paylaşım menüsünden **Ana Ekrana Ekle** ile ayrı pencere olarak kullanabilirsin.

**Dışa aktar → Tam proje** ile fotoğrafları ve işaretleri içeren bir yedek al. Dosyayı iCloud Drive veya cihazının dosya sağlayıcısına kaydedebilirsin. **Projeler → Dosyadan aç** ile geri yükle. Tarayıcı verisini silmeden veya cihaz değiştirmeden önce eşitleme durumunu ya da arşivini kontrol et.

**Bulut ve yedekler** alanından özel HTTPS sunucusuna bağlanıldığında kullanıcılar proje erişimine göre eşitler. Aynı duvar üzerinde çakışan düzenlemeler kullanıcı seçimine gelir. GitHub Pages uygulama dosyalarını sunar. Kurumun proje kayıtları, üyelik parolaları ve fotoğrafları özel sunucuda tutulur. [Özel sunucu kurulumu ve yedekten geri dönüş](server/README.md)

## Ekip

Özel sunucudaki yönetici kullanıcı adıyla üye açar ve parola belirler. İzin verilen projeler için görüntüleme ve düzenleme rolleri vardır. Saha ziyareti açarken ölçüyü alan kişinin adını gir. Yönetici paneli kendi ekibinin işlerinde sahada bildirilen kişi ile sunucuya yazan hesabı ve kayıt zamanını ayrı gösterir. Kamuya açık örnek projeler sentetiktir.

## Yerelde çalıştırma

Python 3.10 veya üstü ve modern bir tarayıcı yeterli. Aşağıdaki komutlar bu klasörden çalıştırılır.

```sh
python3 tests/build_release.py dist
python3 -m http.server 8080 --bind 127.0.0.1 --directory dist
```

Tarayıcıda `http://127.0.0.1:8080/` adresini aç. Çevrimdışı çalışma ve kamera/konum izinleri için uzak cihazlarda HTTPS kullanılır. Ölçü kayıtları milimetre cinsinden saklanır. Görüntüleme birimi olarak m, cm veya mm seçilebilir.

```sh
npm test
python3 -B server/test_api.py
```

Font ve PDF okuyucusunun lisansları `assets/` altında bulunur. Vektör işlemleri ve çizim çevrimdışı çalışır.


<!-- [codex] ureten: codex -->
