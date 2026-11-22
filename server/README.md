# Rölöve Saha özel sunucusu

Web uygulaması projeyi önce o cihazdaki IndexedDB'ye yazar. Özel sunucu açıldığında adlandırılmış kullanıcılar projeyi diğer cihazlardan indirebilir. Telefon veya iPad'de **Bulut ve yedekler → Özel sunucuya bağlan** ile sunucu adresini ve hesabını gir. **Şimdi eşitle** seçili projeyi bu hesaba bağlar. Sonraki değişiklikler pencere açıkken, bağlantı geri geldiğinde ve sekmeye dönünce gönderilir. Hesaba giriş oturum başına yapılır. Kullanıcı ve sunucu değiştirmek bağlı projeyi başka hesaba yüklemez.

## Çalıştırma

Python 3.10 veya üzerindeki standart kütüphane yeterli. Aşağıdaki komutları uygulama dizininde çalıştır. SQLite dosyasını ve yedekleri işletim sistemi erişimi sınırlı, web yayın alanı dışındaki özel bir dizinde sakla. Sunucu ilk açılışta boş veritabanını oluşturur.

```sh
python3 server/server.py --db /ozel/veri/roleve.sqlite3 user-add mimar
python3 server/server.py --db /ozel/veri/roleve.sqlite3 serve --port 8794
```

Hesap açıldığında parolayı etkileşimli istem sorar. Örnek parola veya herkese açık kayıt ekranı bulunmaz. Yetki verilen bir ikinci hesap için aynı komutta farklı kullanıcı adı seçilir. Projenin sahibi **Proje erişimini yönet** ile o hesaba görüntüleme, düzenleme veya erişimi kaldırma işlemi uygular. Erişimi kaldırılan hesabın sonraki sunucu isteği reddedilir. Cihaza önceden indirilen çevrimdışı kopyanın yaşam döngüsü ayrıca yönetilir.

### Ekip yöneticisi ve saha çalışanları

İlk ekip yöneticisini sunucuya erişen kişi özel veritabanında açar. Parola terminaldeki gizli isteme girilir.

```sh
python3 server/server.py --db /ozel/veri/roleve.sqlite3 user-add ekip-yoneticisi --admin
```

Yönetici **Bulut ve yedekler → Ekip üyeleri** ekranında yeni kullanıcıya ad ve ilk parola tanımlar. Buradan parolayı yenileyebilir, çalışanın sunucu erişimini kapatabilir veya yeniden açabilir. Yeni parola ve erişim kapatma işlemi açık sunucu oturumlarını iptal eder. Başlangıç hesabı, eski sunucu hesaplarını kendiliğinden ekibine katmaz. Farklı bir yönetici aynı komutla ayrı bir ekip kurabilir.

**Ekip çalışmaları** yöneticinin ve kendi oluşturduğu saha çalışanlarının sahip olduğu projeleri listeler. Ekip üyesinin projesi yöneticiye görüntüleme izniyle açılır. Projeyi başka bir kullanıcıya düzenleme izniyle paylaşmak ayrıca proje sahibinin kararıdır. Ekip listesi proje, kullanıcı, müşteri veya sahada bildirilen kişiyle aranabilir. Son eşitleyen kullanıcı ve her sürümün zamanı kimliği doğrulanmış sunucu işleminden gelir. Proje sorumlusu ayrıca gösterilir. Ziyaretteki kişi ve ölçüyü alan kişiye ilişkin saha beyanı, sunucuya eşitleyen hesaptan ayrı yer alır. Bağlantısı gelmemiş cihaz çalışması yönetici ekranına ulaşınca görünür. Bir çalışanın başka bir ekibin projesinde davetli olarak yaptığı işlem kendi yöneticisinin ekip listesine taşınmaz.

### Müşteri defteri

Müşteri kartı projesiz de açılabilir. Özel hesabın kartları cihazda bekler ve aynı hesaba bağlantı geldiğinde kendi sunucusuna eşitlenir. Müşteri seçilmiş proje, kartın kimliğini ve adını proje arşivinde ve sürüm geçmişinde taşır. Başka hesaplar, ancak erişebildikleri projeye bağlı müşteri adını görür. Yönetici üyenin bağımsız kartlarını göremez. Henüz hesap açılmadan eklenen bağımsız kartlar bu cihazın çalışma alanında kalır. Aynı cihazda iki kullanıcı aynı projeye yetkiliyse her hesabın çevrimdışı kopyası ayrı tutulur.

Yerelde http://127.0.0.1:8794/api/health biçim sürümünü verir. Önyüzü aynı kökende sunmak için `serve` komutuna `--static /yayin/on-yuz` ekle. Buraya uygulamanın statik yayın paketini koy. Veri dosyası, sunucu kaynakları ve testler yayın paketinin dışında kalır.

## Ağdaki diğer cihazlar

Açık bir HTTPS alan adını kuruma tahsisli sunucuya yönlendir. TLS sonlandıran ters vekil `127.0.0.1:8794` adresine iletir; orijinal Host başlığı korunur. Python hizmeti varsayılan olarak sadece loopback dinler. Aynı kökendeki ön yüz için ek CORS ayarı gerekmez. GitHub Pages gibi başka bir ön yüzden çalıştıracaksan ilgili tam kökeni ekle:

```sh
python3 server/server.py --db /ozel/veri/roleve.sqlite3 serve --port 8794 --allow-origin https://kullaniciadi.github.io
```

Bir GitHub Pages kullanıcı alanında birden fazla uygulama aynı kökeni paylaşır. Özel müşteri rölöveleri için kendi HTTPS ön yüzüne ayrı bir köken vermek, tarayıcıdaki proje kopyasını ve sunucu erişim alanını ayırır. Tek bir medya isteği en çok 256 KiB, proje bilgilerini taşıyan JSON en çok 24 MiB alır. Ters vekili bu istek boyutlarına göre ayarla. Sunucunun diski ve yedekleri özel bina bilgileri ve hesap doğrulayıcıları içerir. Depolama bölgesi, işletim erişimi, disk şifrelemesi, yedek ve silme politikası kurulum sahibine bağlıdır.

## Saha kaydı ve geri dönüş

- Her cihaz kaydı tek bir IndexedDB işleminde proje ve gönderim durumunu yazar. Açık ikinci sekme eski sürümle yazarsa kayıt reddedilir. Büyük fotoğraf metinleri IndexedDB içinde ayrı Blob olarak saklanır. Eski cihaz veritabanındaki düz kayıtlar açılır ve sonraki kayıtta bu biçime geçer. Disk yazma hatası son onaylı çalışmayı korur.
- Her ekin sınırı 40 MiB, bir proje sürümündeki benzersiz dosyaların toplam sınırı 256 MiB’dir. Birden fazla not veya önizleme aynı SHA-256 değerine başvurursa aynı dosya toplamda bir kez sayılır. Aktarım 256 KiB parçalar kullanır. Fotoğraf ile çalışma kopyası, önizleme, işaretler ve ölçü kaynağı aynı sürümde saklanır. JPEG, PNG ve WebP özgün baytları ana fotoğraf olarak taşınır. Tarayıcının açabildiği HEIC, HEIF, AVIF ve GIF için JPEG çalışma kopyasına ek olarak özgün dosyanın adı ve baytları korunur. Kamera biçimlerinin açılması cihaz ve tarayıcıya bağlıdır. SQLite sürümü, bütün ekler uzunluk ve SHA-256 doğrulamasından geçince tek işlemde kesinleşir. Eksik yükleme bağlantı gelince kaldığı parçadan sürer. Son sunucu yanıtı kaybolursa aynı işlem kimliğiyle önceki onay geri alınır.
- Birbirinden bağımsız notlar kimlikleriyle birleşir. Aynı fiziksel duvarın iki uçtan değiştirilmesi bağlanan geometri tercihine gider. Otomatik birleşim geometri kurallarını ihlal ederse uygulama iki proje sürümünü koruyup seçim ister. Silinmiş bir duvara sonradan eklenen not ve fotoğraf yeniden bağlanmak üzere korunur.
- **Sürüm geçmişi** eski kaydı açar, dosya verir, ayrı proje oluşturur veya güncel projeye yeni ileri sürüm olarak geri yükler. Yerel kopyada gönderilmemiş iş varsa önce eşitlenmesi istenir.
- Açık hesapta token yalnız bellekte kalır. Sunucu, token'ın özetini ve sekiz saatlik son kullanma zamanını saklar. Çıkışta sunucu erişimi kapanır, hesaba bağlı cihaz kopyaları arayüzde gizlenir. Bu cihazın işletim sistemi hesabına erişebilen kişiler indirilen veriye erişebilir. Çıkış ekranında seçili projenin gönderilmiş cihaz kopyasını da kaldırabilirsin. Gönderilmemiş projenin zorla silinmesi arayüzden uygulanmaz.
- **Tam proje paketini kaydet** ile tüm yerel proje ve ekleri tek JSON olarak dışa aktar. iPad'in Dosyalar ekranında iCloud Drive veya kullandığın başka bir dosya sağlayıcısının klasörünü seçebilirsin. Dosya kopyası manuel yedektir. Uygulama sağlayıcının yükleme sonucunu göremez.

## Sunucu yedeği ve kurtarma

```sh
python3 server/server.py --db /ozel/veri/roleve.sqlite3 backup /ozel/yedek/roleve-gun1.sqlite3
python3 server/server.py --db /ozel/kurtarma/roleve-deneme.sqlite3 restore /ozel/yedek/roleve-gun1.sqlite3
```

Yedek SQLite'ın online yedek mekanizmasıyla alınır. Geri yüklemede hedef yeni bir dosya olmalı. Hesaplar, ekip bağları, müşteri kartları, proje izinleri, eski sürümler ve kesinleşmiş dosyalar geri gelir. Oturumlar ve yarım dosya yüklemeleri yeni kopyada temizlenir. Yedekten tekrar giriş yaparak sürüm ve fotoğrafı ayrı ortamda açıp kontrol et. Eski sürümlerdeki medya korunduğu için disk kullanımı ziyaret sayısıyla artar. Hizmet yöneticisi yer, saklama süresi ve yedek döngüsünü seçer.

## Kontrol

```sh
python3 -B server/test_api.py
python3 -B server/test_browser.py
```

İkinci komut boş bir yerel SQLite alanı ve sentetik hesaplar hazırlar. Aynı bilgisayarda geçici test adresini tarayıcıda aç. Test iki ayrı cihaz deposu ve ikinci pencere bağlamı kullanır. ATLAS ortamında `/opt/homebrew/bin/python3.14 -B server/test_browser.py --atlas` zaten açık olan normal Chrome'da sadece bu testin sekmesini açıp kapatır. Üretim hesabı ve gerçek proje kullanılmaz.

[codex] Fotoğraf regresyonunda `server/testdata` içindeki 16 × 24 piksellik sentetik AVIF ve HEIC dosyaları ile tarayıcıda üretilen PNG ve JPEG kullanılır. Sonuç JSON’u, üç seçilen özgün dosyanın SHA-256 özetini, benzersiz toplam bayt sayısını ve geri açılan işaret türlerini kaydeder.
