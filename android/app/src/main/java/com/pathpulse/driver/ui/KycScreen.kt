package com.pathpulse.driver.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Lightbulb
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pathpulse.driver.network.CarretKycDocumentSubmission
import com.pathpulse.driver.network.CarretKycStatus
import com.pathpulse.driver.network.CarretSubAccountInput
import com.pathpulse.driver.network.DataRepository
import com.pathpulse.driver.network.UserErrors
import com.pathpulse.driver.ui.theme.PpBackground
import com.pathpulse.driver.ui.theme.PpBlack
import com.pathpulse.driver.ui.theme.PpBlack05
import com.pathpulse.driver.ui.theme.PpBlack15
import com.pathpulse.driver.ui.theme.PpBlack40
import com.pathpulse.driver.ui.theme.PpBlack50
import com.pathpulse.driver.ui.theme.PpBlack60
import com.pathpulse.driver.ui.theme.PpBlack70
import com.pathpulse.driver.ui.theme.PpMint
import com.pathpulse.driver.ui.theme.PpMint26
import com.pathpulse.driver.ui.theme.PpMintInk
import com.pathpulse.driver.ui.theme.PpRed100
import com.pathpulse.driver.ui.theme.PpRed600
import com.pathpulse.driver.ui.theme.PpRed700
import com.pathpulse.driver.ui.theme.PpSize
import com.pathpulse.driver.ui.theme.PpSpace
import com.pathpulse.driver.ui.theme.PpSurface
import com.pathpulse.driver.ui.theme.PpWhite
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Polished multi-step KYC wizard — mirrors iOS `KycView`.
 *
 * Every step is a focused page with a hero mint circle icon, one big question
 * or action, and a sticky primary CTA at the bottom. Pickers are card lists.
 * File pickers are illustrated drop zones. Slim mint progress bar.
 */
private enum class WizardPage(val stepIndex: Int) {
    Welcome(0), Name(1), Contact(2), BornWhen(3), About(4),
    Pan(5), Aadhaar(6), Selfie(7),
    Checking(-1), Verified(-1), Rejected(-1);
    companion object { const val STEP_COUNT = 8 }
}

private data class WizardAction(val label: String, val busyLabel: String)

private enum class Gender(val icon: ImageVector, val label: String) {
    male(Icons.Filled.Person, "Male"),
    female(Icons.Filled.Person, "Female"),
    other(Icons.Filled.Person, "Other"),
}

private val OCCUPATIONS = listOf(
    "Private Job", "Goverment Job", "Business Owner", "Home Maker",
    "Freelancer", "Unemployed", "Student", "Professional",
)
private val INCOMES = listOf(
    "< ₹5 Lakhs", "₹5 Lakhs-₹10 Lakhs", "₹10 Lakhs-₹25 Lakhs",
    "₹25 Lakhs-₹50 Lakhs", "₹50 Lakhs-1 Crore", ">₹1 Crore",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KycScreen(
    modifier: Modifier = Modifier,
    dataRepository: DataRepository = remember { DataRepository() },
    onDismiss: () -> Unit = {},
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()

    var page by remember { mutableStateOf(WizardPage.Welcome) }
    var submitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    var accountId by remember { mutableStateOf("") }
    var sessionId by remember { mutableStateOf("") }

    var firstName by remember { mutableStateOf("") }
    var lastName by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }          // digits only, no country code
    var dialCode by remember { mutableStateOf(DialCode.India) }
    // Nullable Long = millis since epoch (UTC). Backend format = dd/MM/yyyy.
    var dobMillis by remember { mutableStateOf<Long?>(null) }
    val country = "IN"
    var gender by remember { mutableStateOf(Gender.male) }
    var occupation by remember { mutableStateOf("Business Owner") }
    var income by remember { mutableStateOf("₹5 Lakhs-₹10 Lakhs") }

    var panNumber by remember { mutableStateOf("") }
    var panName by remember { mutableStateOf("") }
    var panDobMillis by remember { mutableStateOf<Long?>(null) }

    val dob = dobMillis?.let { formatDob(it) } ?: ""
    val panDob = panDobMillis?.let { formatDob(it) } ?: ""
    // Carret's /register/ expects a bare 10-digit local number (no `+`, no
    // country code). The dial-code picker is UI-only — we only send `phone`.
    val fullPhone = phone.filter { it.isDigit() }

    var aadhaarUri by remember { mutableStateOf<Uri?>(null) }
    var aadhaarName by remember { mutableStateOf<String?>(null) }
    var selfieUri by remember { mutableStateOf<Uri?>(null) }
    var selfieName by remember { mutableStateOf<String?>(null) }

    val pickAadhaar = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent(),
    ) { uri ->
        aadhaarUri = uri
        aadhaarName = uri?.let { readDisplayName(ctx, it) }
    }
    val pickSelfie = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent(),
    ) { uri ->
        selfieUri = uri
        selfieName = uri?.let { readDisplayName(ctx, it) }
    }

    var kycStatus by remember { mutableStateOf<CarretKycStatus?>(null) }
    var pollingJob by remember { mutableStateOf<Job?>(null) }

    fun startPolling() {
        pollingJob?.cancel()
        pollingJob = scope.launch {
            while (isActive) {
                try {
                    val s = dataRepository.getCarretKycStatus(accountId)
                    kycStatus = s
                    when (s.kyc_status) {
                        "verified" -> { page = WizardPage.Verified; break }
                        "rejected" -> { page = WizardPage.Rejected; break }
                    }
                } catch (_: Exception) { /* keep polling */ }
                delay(3000)
            }
        }
    }

    suspend fun doCreateSubAccount(): Boolean = try {
        val acc = dataRepository.createCarretSubAccount(
            CarretSubAccountInput(
                email = email,
                phone_number = fullPhone,
                first_name = firstName, last_name = lastName,
                dob = dob, country = country,
                gender = gender.name,
                occupation = occupation,
                annual_income = income,
            ),
        )
        accountId = acc.id.toString(); true
    } catch (e: Exception) { error = UserErrors.message(e); false }

    suspend fun doInitiate(): Boolean = try {
        val r = dataRepository.initiateCarretKyc(accountId)
        sessionId = r.session.session_id; true
    } catch (e: Exception) { error = UserErrors.message(e); false }

    suspend fun doSubmitPan(): Boolean = try {
        dataRepository.submitCarretKycDocument(
            sessionId,
            CarretKycDocumentSubmission(
                document_type = "pan",
                document_number = panNumber.uppercase(),
                name = panName, dob = panDob,
            ),
        ); true
    } catch (e: Exception) { error = UserErrors.message(e); false }

    suspend fun doUploadAadhaar(): Boolean {
        val uri = aadhaarUri ?: return false
        val name = aadhaarName ?: "aadhaar"
        val (bytes, mime) = readBytesAndMime(ctx, uri) ?: return false
        val ext = name.substringAfterLast('.', "").lowercase()
        val fileType = if (ext == "xml" || ext == "zip") "xml" else "image"
        return try {
            dataRepository.uploadCarretKycFile(
                kycSession = sessionId, docType = "aadhaar",
                fileType = fileType, filename = name,
                fileBytes = bytes, mimeType = mime,
            ); true
        } catch (e: Exception) { error = UserErrors.message(e); false }
    }

    suspend fun doUploadSelfie(): Boolean {
        val uri = selfieUri ?: return false
        val name = selfieName ?: "selfie.jpg"
        val (bytes, mime) = readBytesAndMime(ctx, uri) ?: return false
        return try {
            dataRepository.uploadCarretKycFile(
                kycSession = sessionId, docType = "selfie",
                fileType = "image", filename = name,
                fileBytes = bytes, mimeType = mime,
            ); true
        } catch (e: Exception) { error = UserErrors.message(e); false }
    }

    suspend fun doCleanupAndRetry() {
        try {
            dataRepository.cleanupCarretKyc(accountId)
            sessionId = ""; kycStatus = null; pollingJob?.cancel()
            page = WizardPage.Name; error = null
        } catch (e: Exception) { error = UserErrors.message(e) }
    }

    fun onLeft() {
        error = null
        val prev = previousPage(page)
        if (prev != null) page = prev else { pollingJob?.cancel(); onDismiss() }
    }

    fun performAction() {
        scope.launch {
            submitting = true; error = null
            try {
                when (page) {
                    WizardPage.Welcome  -> page = WizardPage.Name
                    WizardPage.Name     -> page = WizardPage.Contact
                    WizardPage.Contact  -> page = WizardPage.BornWhen
                    WizardPage.BornWhen -> {
                        page = WizardPage.About
                        if (panDobMillis == null) panDobMillis = dobMillis
                    }
                    WizardPage.About    -> if (doCreateSubAccount() && doInitiate()) page = WizardPage.Pan
                    WizardPage.Pan      -> if (doSubmitPan()) page = WizardPage.Aadhaar
                    WizardPage.Aadhaar  -> if (doUploadAadhaar()) page = WizardPage.Selfie
                    WizardPage.Selfie   -> if (doUploadSelfie()) {
                        page = WizardPage.Checking
                        startPolling()
                    }
                    else -> Unit
                }
            } finally { submitting = false }
        }
    }

    val action = actionFor(page)
    val actionEnabled = when (page) {
        WizardPage.Welcome  -> true
        WizardPage.Name     -> firstName.isNotEmpty() && lastName.isNotEmpty()
        WizardPage.Contact  -> email.contains("@") && phone.length == 10
        WizardPage.BornWhen -> dobMillis != null
        WizardPage.About    -> true
        WizardPage.Pan      -> panNumber.length >= 10 && panName.isNotEmpty() && panDobMillis != null
        WizardPage.Aadhaar  -> aadhaarUri != null
        WizardPage.Selfie   -> selfieUri != null
        else -> false
    }

    Box(modifier = modifier.fillMaxSize().background(PpBackground)) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Toolbar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = PpSpace.sm, vertical = PpSpace.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = { onLeft() }) {
                    Icon(
                        if (page == WizardPage.Welcome) Icons.Filled.Close else Icons.Filled.ArrowBack,
                        contentDescription = "Back",
                        tint = PpBlack,
                    )
                }
                Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.Center) {
                    Text(
                        navTitle(page),
                        style = MaterialTheme.typography.labelLarge,
                        color = PpBlack,
                    )
                }
                Spacer(modifier = Modifier.width(48.dp))
            }

            // Progress bar
            if (page != WizardPage.Verified && page != WizardPage.Rejected && page.stepIndex >= 0) {
                val frac = (page.stepIndex + 1).toFloat() / WizardPage.STEP_COUNT.toFloat()
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = PpSize.screenPadding, vertical = PpSpace.sm),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(PpSpace.sm),
                ) {
                    LinearProgressIndicator(
                        progress = { frac },
                        color = PpMint,
                        trackColor = PpBlack05,
                        modifier = Modifier
                            .weight(1f)
                            .height(4.dp)
                            .clip(RoundedCornerShape(2.dp)),
                    )
                    Text(
                        "Step ${page.stepIndex + 1} of ${WizardPage.STEP_COUNT}",
                        style = MaterialTheme.typography.labelSmall,
                        color = PpBlack50,
                    )
                }
            }

            // Error banner
            error?.let { msg ->
                Row(
                    modifier = Modifier
                        .padding(horizontal = PpSize.screenPadding, vertical = PpSpace.xs)
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(PpRed100)
                        .padding(PpSpace.md),
                    verticalAlignment = Alignment.Top,
                    horizontalArrangement = Arrangement.spacedBy(PpSpace.sm),
                ) {
                    Icon(Icons.Filled.Warning, contentDescription = null, tint = PpRed600, modifier = Modifier.size(20.dp))
                    Text(msg, style = MaterialTheme.typography.bodySmall, color = PpRed700)
                }
            }

            // Content
            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(bottom = PpSpace.xxxl),
            ) {
                when (page) {
                    WizardPage.Welcome -> WelcomePage()
                    WizardPage.Name -> NamePage(firstName, { firstName = it }, lastName, { lastName = it })
                    WizardPage.Contact -> ContactPage(
                        email, { email = it },
                        phone, { phone = it.filter { c -> c.isDigit() } },
                        dialCode, { dialCode = it },
                    )
                    WizardPage.BornWhen -> DobPage(dobMillis) { dobMillis = it }
                    WizardPage.About -> AboutPage(gender, { gender = it }, occupation, { occupation = it }, income, { income = it })
                    WizardPage.Pan -> PanPage(
                        panNumber, { panNumber = it.uppercase() },
                        panName, { panName = it },
                        panDobMillis, { panDobMillis = it },
                    )
                    WizardPage.Aadhaar -> AadhaarPage(aadhaarName) { pickAadhaar.launch("*/*") }
                    WizardPage.Selfie -> SelfiePage(selfieName) { pickSelfie.launch("image/*") }
                    WizardPage.Checking -> CheckingPage(kycStatus?.kyc_status == "manual_review")
                    WizardPage.Verified -> OutcomePage(
                        iconBg = PpMint26, iconFg = PpMint, icon = Icons.Filled.CheckCircle,
                        title = "You're verified",
                        subtitle = "All set. You can now withdraw your USDC rewards to your bank.",
                        primary = "Start using PathPulse",
                        primaryAction = { pollingJob?.cancel(); onDismiss() },
                    )
                    WizardPage.Rejected -> OutcomePage(
                        iconBg = PpRed100, iconFg = PpRed600, icon = Icons.Filled.Warning,
                        title = "We couldn't verify you",
                        subtitle = "Something didn't match. Try again with clearer documents — usually a name spelling mismatch on PAN, or a low-quality Aadhaar upload.",
                        primary = "Start over",
                        primaryAction = { scope.launch { doCleanupAndRetry() } },
                    )
                }
            }

            // Sticky CTA
            if (action != null) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(PpBackground)
                        .padding(horizontal = PpSize.screenPadding, vertical = PpSpace.md),
                ) {
                    val enabled = actionEnabled && !submitting
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp)
                            .clip(CircleShape)
                            .background(if (enabled) PpBlack else PpBlack50)
                            .clickable(enabled = enabled) { performAction() },
                        contentAlignment = Alignment.Center,
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(PpSpace.sm)) {
                            if (submitting) {
                                CircularProgressIndicator(
                                    color = PpWhite, strokeWidth = 2.dp,
                                    modifier = Modifier.size(18.dp),
                                )
                            }
                            Text(
                                if (submitting) action.busyLabel else action.label,
                                color = PpWhite,
                                style = MaterialTheme.typography.labelLarge,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }
            }
        }
    }

    LaunchedEffect(Unit) {
        // Nothing on mount — polling is triggered from Selfie submission.
    }
}

// -----------------------------------------------------------------------------
// Pages
// -----------------------------------------------------------------------------

@Composable
private fun WelcomePage() {
    PageShell(
        icon = Icons.Filled.Shield,
        title = "Let's verify your identity",
        subtitle = "A one-time check so you can withdraw to your bank. Takes about 3 minutes.",
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(PpSpace.md),
            modifier = Modifier.padding(top = PpSpace.lg),
        ) {
            Bullet("Your name & basic details")
            Bullet("PAN card")
            Bullet("Aadhaar (from DigiLocker, or a photo)")
            Bullet("A quick selfie")
        }
    }
}

@Composable
private fun NamePage(firstName: String, onFirst: (String) -> Unit, lastName: String, onLast: (String) -> Unit) {
    PageShell(
        icon = Icons.Filled.Person,
        title = "What's your name?",
        subtitle = "Enter your name exactly as it appears on your PAN card.",
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(PpSpace.md),
            modifier = Modifier.padding(top = PpSpace.lg),
        ) {
            BigField("First name", firstName, onFirst)
            BigField("Last name", lastName, onLast)
        }
    }
}

@Composable
private fun ContactPage(
    email: String, onEmail: (String) -> Unit,
    phone: String, onPhone: (String) -> Unit,
    dialCode: DialCode, onDialCode: (DialCode) -> Unit,
) {
    PageShell(
        icon = Icons.Filled.Email,
        title = "How can we reach you?",
        subtitle = "We'll send transaction updates to your email and phone.",
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(PpSpace.md),
            modifier = Modifier.padding(top = PpSpace.lg),
        ) {
            BigField("Email", email, onEmail, placeholder = "you@gmail.com", keyboard = KeyboardType.Email)
            PhoneField(phone = phone, onPhone = onPhone, dialCode = dialCode, onDialCode = onDialCode)
        }
    }
}

@Composable
private fun PhoneField(
    phone: String,
    onPhone: (String) -> Unit,
    dialCode: DialCode,
    onDialCode: (DialCode) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(PpSpace.xs)) {
        Text("Phone", style = MaterialTheme.typography.labelSmall, color = PpBlack50)
        Row(horizontalArrangement = Arrangement.spacedBy(PpSpace.sm)) {
            Box {
                Row(
                    modifier = Modifier
                        .height(56.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(PpSurface)
                        .border(1.dp, PpBlack15, RoundedCornerShape(14.dp))
                        .clickable { expanded = true }
                        .padding(horizontal = PpSpace.md),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(PpSpace.xs),
                ) {
                    Text(dialCode.flag, fontSize = 18.sp)
                    Text("+${dialCode.digits}", style = MaterialTheme.typography.bodyLarge, color = PpBlack)
                    Icon(Icons.Filled.KeyboardArrowRight, contentDescription = null, tint = PpBlack50, modifier = Modifier.size(16.dp))
                }
                DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                    DialCode.entries.forEach { dc ->
                        DropdownMenuItem(
                            text = { Text("${dc.flag}  ${dc.displayName}  +${dc.digits}") },
                            onClick = { onDialCode(dc); expanded = false },
                        )
                    }
                }
            }
            OutlinedTextField(
                value = phone,
                onValueChange = onPhone,
                singleLine = true,
                placeholder = { Text("9XXXXXXXXX", color = PpBlack40) },
                shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = PpSurface,
                    unfocusedContainerColor = PpSurface,
                    focusedIndicatorColor = PpMint,
                    unfocusedIndicatorColor = PpBlack15,
                ),
                modifier = Modifier.weight(1f).height(56.dp),
            )
        }
    }
}

@Composable
private fun DobPage(millis: Long?, onMillis: (Long?) -> Unit) {
    PageShell(
        icon = Icons.Filled.DateRange,
        title = "Your date of birth",
        subtitle = "Pick the date exactly as it appears on your PAN card.",
    ) {
        Column(modifier = Modifier.padding(top = PpSpace.lg)) {
            DatePickerField(label = "Date of birth", millis = millis, onMillis = onMillis)
        }
    }
}

@Composable
private fun AboutPage(
    gender: Gender, onGender: (Gender) -> Unit,
    occupation: String, onOccupation: (String) -> Unit,
    income: String, onIncome: (String) -> Unit,
) {
    PageShell(
        icon = Icons.Filled.Badge,
        title = "Tell us about yourself",
        subtitle = "A few quick details required by the payments partner.",
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(PpSpace.lg),
            modifier = Modifier.padding(top = PpSpace.lg),
        ) {
            LabeledSection("Gender") {
                Row(horizontalArrangement = Arrangement.spacedBy(PpSpace.sm)) {
                    Gender.entries.forEach { g ->
                        GenderChip(g, selected = gender == g, onClick = { onGender(g) }, modifier = Modifier.weight(1f))
                    }
                }
            }
            LabeledSection("Occupation") {
                CardPicker(selection = occupation, options = OCCUPATIONS, onSelect = onOccupation)
            }
            LabeledSection("Annual income") {
                CardPicker(selection = income, options = INCOMES, onSelect = onIncome)
            }
            LabeledSection("Country") {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(PpSurface)
                        .border(1.5.dp, PpMint, RoundedCornerShape(14.dp))
                        .padding(PpSpace.md),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("🇮🇳", fontSize = 22.sp)
                    Spacer(modifier = Modifier.width(PpSpace.sm))
                    Text("India", style = MaterialTheme.typography.bodyLarge, color = PpBlack)
                    Spacer(modifier = Modifier.weight(1f))
                    Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = PpMint, modifier = Modifier.size(20.dp))
                }
            }
        }
    }
}

@Composable
private fun PanPage(
    panNumber: String, onPan: (String) -> Unit,
    panName: String, onName: (String) -> Unit,
    panDobMillis: Long?, onPanDobMillis: (Long?) -> Unit,
) {
    PageShell(
        icon = Icons.Filled.CreditCard,
        title = "Enter your PAN card",
        subtitle = "Copy these exactly as printed on the card — name spelling and DOB must match India's tax records.",
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(PpSpace.md),
            modifier = Modifier.padding(top = PpSpace.lg),
        ) {
            BigField("PAN number (10 characters)", panNumber, onPan, placeholder = "ABCDE1234F", capitalization = KeyboardCapitalization.Characters)
            BigField("Name on card", panName, onName, placeholder = "e.g. RAHUL KUMAR SHARMA")
            DatePickerField(label = "Date of birth", millis = panDobMillis, onMillis = onPanDobMillis)
        }
    }
}

@Composable
private fun AadhaarPage(fileName: String?, onPick: () -> Unit) {
    PageShell(
        icon = Icons.Filled.CloudUpload,
        title = "Upload your Aadhaar",
        subtitle = "The DigiLocker XML verifies fastest, but a clear photo or PDF of your card also works.",
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(PpSpace.md),
            modifier = Modifier.padding(top = PpSpace.lg),
        ) {
            DropZone(
                icon = if (fileName == null) Icons.Filled.CloudUpload else Icons.Filled.CheckCircle,
                title = fileName ?: "Choose Aadhaar file",
                subtitle = if (fileName == null) "XML, ZIP, JPG, PNG, or PDF" else "Ready to upload",
                selected = fileName != null,
                onClick = onPick,
            )
            InfoTile(
                icon = Icons.Filled.Lightbulb,
                text = "Pro tip: DigiLocker → Aadhaar → Share as XML → set a 4-digit code → download the ZIP. That's the fastest path to verified.",
            )
        }
    }
}

@Composable
private fun SelfiePage(fileName: String?, onPick: () -> Unit) {
    PageShell(
        icon = Icons.Filled.CameraAlt,
        title = "Take a selfie",
        subtitle = "Front-facing, well-lit, plain background. We'll match it against your Aadhaar photo.",
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(PpSpace.md),
            modifier = Modifier.padding(top = PpSpace.lg),
        ) {
            DropZone(
                icon = if (fileName == null) Icons.Filled.PhotoCamera else Icons.Filled.CheckCircle,
                title = fileName ?: "Choose a selfie",
                subtitle = if (fileName == null) "From your camera roll" else "Ready to upload",
                selected = fileName != null,
                onClick = onPick,
            )
            InfoTile(
                icon = Icons.Filled.Lightbulb,
                text = "For best results: no mask, no sunglasses, face fully lit, blank wall behind you.",
            )
        }
    }
}

@Composable
private fun CheckingPage(manualReview: Boolean) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = PpSpace.xxxl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(PpSpace.xl),
    ) {
        Box(
            modifier = Modifier.size(140.dp).clip(CircleShape).background(PpMint26),
            contentAlignment = Alignment.Center,
        ) {
            CircularProgressIndicator(color = PpMint, strokeWidth = 4.dp, modifier = Modifier.size(72.dp))
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(PpSpace.sm)) {
            Text("Verifying your identity", style = MaterialTheme.typography.headlineSmall, color = PpBlack)
            Text(
                "This usually takes a few seconds. We'll show the result here as soon as it's done.",
                style = MaterialTheme.typography.bodyMedium,
                color = PpBlack60,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = PpSize.screenPadding),
            )
        }
        if (manualReview) {
            Box(modifier = Modifier.padding(horizontal = PpSize.screenPadding)) {
                InfoTile(
                    icon = Icons.Filled.Person,
                    text = "Under manual review by our partner. This can take a few hours — we'll notify you when it's done.",
                )
            }
        }
    }
}

@Composable
private fun OutcomePage(
    iconBg: androidx.compose.ui.graphics.Color,
    iconFg: androidx.compose.ui.graphics.Color,
    icon: ImageVector,
    title: String, subtitle: String,
    primary: String, primaryAction: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = PpSpace.xxxl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(PpSpace.xl),
    ) {
        Box(
            modifier = Modifier.size(140.dp).clip(CircleShape).background(iconBg),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = iconFg, modifier = Modifier.size(72.dp))
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(PpSpace.sm)) {
            Text(title, style = MaterialTheme.typography.headlineSmall, color = PpBlack, textAlign = TextAlign.Center)
            Text(
                subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = PpBlack60,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = PpSize.screenPadding),
            )
        }
        Spacer(modifier = Modifier.height(PpSpace.xl))
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = PpSize.screenPadding)
                .height(56.dp)
                .clip(CircleShape)
                .background(PpBlack)
                .clickable(onClick = primaryAction),
            contentAlignment = Alignment.Center,
        ) {
            Text(primary, color = PpWhite, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
        }
    }
}

// -----------------------------------------------------------------------------
// Reusable chunks
// -----------------------------------------------------------------------------

@Composable
private fun PageShell(
    icon: ImageVector,
    title: String,
    subtitle: String,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = PpSize.screenPadding),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(PpSpace.md),
    ) {
        Box(
            modifier = Modifier.padding(top = PpSpace.xl).size(96.dp).clip(CircleShape).background(PpMint26),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = PpMintInk, modifier = Modifier.size(48.dp))
        }
        Text(
            title,
            style = MaterialTheme.typography.headlineSmall,
            color = PpBlack,
            textAlign = TextAlign.Center,
        )
        Text(
            subtitle,
            style = MaterialTheme.typography.bodyMedium,
            color = PpBlack60,
            textAlign = TextAlign.Center,
        )
        Box(modifier = Modifier.fillMaxWidth()) { content() }
    }
}

@Composable
private fun Bullet(text: String) {
    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(PpSpace.sm)) {
        Box(
            modifier = Modifier.size(24.dp).clip(CircleShape).background(PpMint26),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Filled.Check, contentDescription = null, tint = PpMintInk, modifier = Modifier.size(14.dp))
        }
        Text(text, style = MaterialTheme.typography.bodyMedium, color = PpBlack70)
    }
}

@Composable
private fun BigField(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    placeholder: String = "",
    keyboard: KeyboardType = KeyboardType.Text,
    capitalization: KeyboardCapitalization = KeyboardCapitalization.None,
) {
    Column(verticalArrangement = Arrangement.spacedBy(PpSpace.xs)) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = PpBlack50)
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            placeholder = { Text(placeholder, color = PpBlack40) },
            shape = RoundedCornerShape(14.dp),
            keyboardOptions = KeyboardOptions(keyboardType = keyboard, capitalization = capitalization),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = PpSurface,
                unfocusedContainerColor = PpSurface,
                focusedIndicatorColor = PpMint,
                unfocusedIndicatorColor = PpBlack15,
            ),
            modifier = Modifier.fillMaxWidth().height(56.dp),
        )
    }
}

@Composable
private fun LabeledSection(label: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(PpSpace.sm)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = PpBlack70)
        content()
    }
}

@Composable
private fun GenderChip(g: Gender, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .height(72.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(if (selected) PpMint26 else PpSurface)
            .border(1.5.dp, if (selected) PpMint else PpBlack05, RoundedCornerShape(14.dp))
            .clickable(onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(g.icon, contentDescription = null, tint = if (selected) PpMintInk else PpBlack70, modifier = Modifier.size(22.dp))
        Spacer(modifier = Modifier.height(PpSpace.xs))
        Text(g.label, style = MaterialTheme.typography.labelMedium, color = if (selected) PpMintInk else PpBlack)
    }
}

@Composable
private fun CardPicker(selection: String, options: List<String>, onSelect: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(PpSpace.xs)) {
        options.forEach { opt ->
            val selected = selection == opt
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(if (selected) PpMint26 else PpSurface)
                    .border(1.5.dp, if (selected) PpMint else PpBlack05, RoundedCornerShape(14.dp))
                    .clickable { onSelect(opt) }
                    .padding(PpSpace.md),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(opt, style = MaterialTheme.typography.bodyLarge, color = PpBlack, modifier = Modifier.weight(1f))
                Icon(
                    if (selected) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked,
                    contentDescription = null,
                    tint = if (selected) PpMint else PpBlack15,
                    modifier = Modifier.size(22.dp),
                )
            }
        }
    }
}

@Composable
private fun DropZone(
    icon: ImageVector,
    title: String,
    subtitle: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(PpSurface)
            .border(1.5.dp, if (selected) PpMint else PpBlack05, RoundedCornerShape(18.dp))
            .clickable(onClick = onClick)
            .padding(PpSpace.md),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(PpSpace.md),
    ) {
        Box(
            modifier = Modifier.size(56.dp).clip(CircleShape).background(if (selected) PpMint26 else PpBlack05),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = if (selected) PpMint else PpBlack70, modifier = Modifier.size(24.dp))
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = PpBlack, maxLines = 1)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = PpBlack50)
        }
        Icon(Icons.Filled.KeyboardArrowRight, contentDescription = null, tint = PpBlack40, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun InfoTile(icon: ImageVector, text: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(PpMint26.copy(alpha = 0.4f))
            .padding(PpSpace.md),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(PpSpace.sm),
    ) {
        Icon(icon, contentDescription = null, tint = PpMint, modifier = Modifier.size(18.dp))
        Text(text, style = MaterialTheme.typography.bodySmall, color = PpBlack70, modifier = Modifier.weight(1f))
    }
}

// -----------------------------------------------------------------------------
// Wizard helpers
// -----------------------------------------------------------------------------

private fun previousPage(p: WizardPage): WizardPage? = when (p) {
    WizardPage.Welcome  -> null
    WizardPage.Name     -> WizardPage.Welcome
    WizardPage.Contact  -> WizardPage.Name
    WizardPage.BornWhen -> WizardPage.Contact
    WizardPage.About    -> WizardPage.BornWhen
    WizardPage.Pan      -> WizardPage.About
    WizardPage.Aadhaar  -> WizardPage.Pan
    WizardPage.Selfie   -> WizardPage.Aadhaar
    WizardPage.Checking, WizardPage.Verified, WizardPage.Rejected -> null
}

private fun navTitle(p: WizardPage): String = when (p) {
    WizardPage.Welcome -> "Verification"
    WizardPage.Name, WizardPage.Contact, WizardPage.BornWhen, WizardPage.About -> "About you"
    WizardPage.Pan -> "PAN card"
    WizardPage.Aadhaar -> "Aadhaar"
    WizardPage.Selfie -> "Selfie"
    WizardPage.Checking -> "Verifying"
    WizardPage.Verified, WizardPage.Rejected -> "Verification"
}

private fun actionFor(p: WizardPage): WizardAction? = when (p) {
    WizardPage.Welcome  -> WizardAction("Get started",    "Get started")
    WizardPage.Name, WizardPage.Contact, WizardPage.BornWhen -> WizardAction("Continue", "Continue")
    WizardPage.About    -> WizardAction("Continue",       "Saving…")
    WizardPage.Pan      -> WizardAction("Verify PAN",     "Checking…")
    WizardPage.Aadhaar  -> WizardAction("Upload Aadhaar", "Uploading…")
    WizardPage.Selfie   -> WizardAction("Upload photo",   "Uploading…")
    else -> null
}

// -----------------------------------------------------------------------------
// File helpers
// -----------------------------------------------------------------------------

/**
 * Common ISD codes for the KYC phone field. India first (most drivers).
 * Backend expects a bare 10–12 digit string (no `+`), so callers concat
 * `digits + local`.
 */
private enum class DialCode(val digits: String, val flag: String, val displayName: String) {
    India("91", "🇮🇳", "India"),
    UAE("971", "🇦🇪", "UAE"),
    USA("1", "🇺🇸", "USA"),
    UK("44", "🇬🇧", "UK"),
    Singapore("65", "🇸🇬", "Singapore"),
    Canada("1", "🇨🇦", "Canada"),
    Australia("61", "🇦🇺", "Australia"),
}

private val DOB_FORMAT = java.text.SimpleDateFormat("dd/MM/yyyy", java.util.Locale("en", "IN")).apply {
    timeZone = java.util.TimeZone.getTimeZone("UTC")
}
private fun formatDob(millis: Long): String = DOB_FORMAT.format(java.util.Date(millis))

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DatePickerField(label: String, millis: Long?, onMillis: (Long?) -> Unit) {
    var showPicker by remember { mutableStateOf(false) }
    val maxMillis = remember {
        // 18 years ago today (KYC minimum age).
        val c = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC"))
        c.add(java.util.Calendar.YEAR, -18)
        c.timeInMillis
    }
    val minMillis = remember {
        val c = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC"))
        c.add(java.util.Calendar.YEAR, -100)
        c.timeInMillis
    }
    Column(verticalArrangement = Arrangement.spacedBy(PpSpace.xs)) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = PpBlack50)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(PpSurface)
                .border(1.dp, PpBlack15, RoundedCornerShape(14.dp))
                .clickable { showPicker = true }
                .padding(horizontal = PpSpace.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.DateRange, contentDescription = null, tint = PpBlack50, modifier = Modifier.size(20.dp))
            Spacer(modifier = Modifier.width(PpSpace.sm))
            Text(
                millis?.let { formatDob(it) } ?: "Pick a date",
                style = MaterialTheme.typography.bodyLarge,
                color = if (millis == null) PpBlack40 else PpBlack,
                modifier = Modifier.weight(1f),
            )
            Icon(Icons.Filled.KeyboardArrowRight, contentDescription = null, tint = PpBlack40, modifier = Modifier.size(20.dp))
        }
    }

    if (showPicker) {
        val state = rememberDatePickerState(
            initialSelectedDateMillis = millis ?: maxMillis,
            yearRange = run {
                val cal = java.util.Calendar.getInstance()
                (cal.get(java.util.Calendar.YEAR) - 100)..(cal.get(java.util.Calendar.YEAR) - 18)
            },
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long): Boolean =
                    utcTimeMillis in minMillis..maxMillis
            },
        )
        DatePickerDialog(
            onDismissRequest = { showPicker = false },
            confirmButton = {
                TextButton(onClick = {
                    onMillis(state.selectedDateMillis)
                    showPicker = false
                }) { Text("OK") }
            },
            dismissButton = {
                TextButton(onClick = { showPicker = false }) { Text("Cancel") }
            },
        ) {
            DatePicker(state = state, showModeToggle = true)
        }
    }
}

private fun readDisplayName(ctx: android.content.Context, uri: Uri): String? =
    ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
        val idx = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
        if (c.moveToFirst() && idx >= 0) c.getString(idx) else null
    }

private fun readBytesAndMime(ctx: android.content.Context, uri: Uri): Pair<ByteArray, String>? {
    val mime = ctx.contentResolver.getType(uri) ?: "application/octet-stream"
    val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
    return bytes to mime
}
